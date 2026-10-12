"""AnalysisOrchestrator -- runs the full 9-stage SatQuery AI pipeline (spec §4/§17)
for one mission, end to end, persisting a real ExecutionStep row per stage/service
call and a real Evidence row per evidence object produced.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.db.models import Evidence, ExecutionStep, Mission, Observation
from app.demo_data.generate_imagery import STATIC_DIR
from app.demo_data.scenarios import IMG_SIZE, REGIONS
from app.orchestration.workflow_planner import classify_tasks, select_services
from app.services import change_analysis, cross_modal_analysis
from app.services import evidence as evidence_svc
from app.services import confidence as confidence_svc
from app.services.input_validation import validate_geospatial, validate_inputs
from app.services.query_understanding import understand_query
from app.services.vqa_grounding import answer_vqa, compute_landcover_stats, generate_caption, ground_query

STAGES = [
    "query_understanding", "input_validation", "workflow_selection", "service_selection",
    "workflow_execution", "evidence_aggregation", "evidence_validation",
    "confidence_estimation", "answer_generation",
]


class PipelineError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_observations(db: Session, mode: str, region_key: str) -> list[Observation]:
    obs = db.query(Observation).filter(Observation.region_key == region_key).all()
    if mode == "bi_temporal":
        before = next((o for o in obs if o.role == "before"), None)
        after = next((o for o in obs if o.role == "after"), None)
        if not before or not after:
            raise PipelineError(f"Region '{region_key}' has no before/after observation pair for bi-temporal analysis.")
        return [before, after]
    if mode in ("optical_sar", "region_centric"):
        optical = next((o for o in obs if o.role == "optical"), None)
        sar = next((o for o in obs if o.role == "sar"), None)
        if not optical or not sar:
            raise PipelineError(f"Region '{region_key}' has no co-registered optical+SAR pair.")
        return [optical, sar]
    if mode == "single_image":
        single = next((o for o in obs if o.role == "single"), None)
        if not single:
            raise PipelineError(f"Region '{region_key}' has no single-image observation.")
        return [single]
    raise PipelineError(f"Unknown analysis mode '{mode}'.")


class _StepLogger:
    """Small stateful helper so orchestrator code reads as a linear stage sequence."""

    def __init__(self, db: Session, mission: Mission):
        self.db = db
        self.mission = mission
        self.index = 0

    def run(self, stage: str, service_name: str, input_summary: str, fn, warnings: list[str] | None = None):
        self.index += 1
        started = _now()
        try:
            output = fn()
            status = "warning" if warnings else "completed"
        except Exception as exc:  # pragma: no cover - safety net, not expected in demo data
            step = ExecutionStep(
                mission_id=self.mission.id, step_index=self.index, stage=stage, service_name=service_name,
                status="failed", input_summary=input_summary, output_summary=str(exc),
                warnings=[], started_at=started, completed_at=_now(),
            )
            self.db.add(step)
            self.db.flush()
            raise
        step = ExecutionStep(
            mission_id=self.mission.id, step_index=self.index, stage=stage, service_name=service_name,
            status=status, input_summary=input_summary,
            output_summary=_summarize(output), warnings=warnings or [],
            started_at=started, completed_at=_now(),
        )
        self.db.add(step)
        self.db.flush()
        return output


def _summarize(output) -> str:
    if isinstance(output, dict):
        keys = list(output.keys())[:6]
        return f"Produced fields: {', '.join(keys)}" + (" ..." if len(output) > 6 else "")
    if isinstance(output, list):
        return f"Produced {len(output)} item(s)."
    return str(output)[:300]


def run_mission_pipeline(db: Session, mission: Mission) -> Mission:
    region = REGIONS.get(
        mission.region_key,
        {
            "label": mission.title,
            "description": "User-uploaded observation analyzed with SatQuery AI.",
            "bbox": [77.101, 15.602, 77.151, 15.652],
            "modes": [mission.mode],
        },
    )
    logger = _StepLogger(db, mission)

    # ---- Stage 1: Understanding Query -------------------------------------------------
    qu = logger.run(
        "query_understanding", "QueryUnderstandingService", mission.query_text,
        lambda: understand_query(mission.query_text),
    )
    mission.query_understanding = qu

    # ---- Stage 2: Validating Inputs -----------------------------------------------------
    try:
        observations = _get_observations(db, mission.mode, mission.region_key)
    except PipelineError as exc:
        try:
            logger.run(
                "input_validation", "InputValidationService", mission.region_key,
                lambda: (_ for _ in ()).throw(exc),
            )
        except PipelineError:
            pass
        mission.status = "failed"
        mission.result = {"answer": str(exc), "key_findings": [], "uncertainty": [str(exc)],
                           "evidence_validation": {"status": "INSUFFICIENT_EVIDENCE", "notes": [str(exc)]},
                           "sensor_consistency": None, "demo_label": "DEMO / PROTOTYPE OUTPUT"}
        db.commit()
        return mission

    input_result = logger.run(
        "input_validation", "InputValidationService",
        f"{len(observations)} observation(s) for region '{mission.region_key}'",
        lambda: validate_inputs(observations),
    )
    geo_result = logger.run(
        "input_validation", "GeospatialValidationService",
        f"CRS/footprint/temporal checks for {len(observations)} observation(s)",
        lambda: validate_geospatial(observations),
    )
    mission.validation = {"input_checks": input_result["checks"], "geo_checks": geo_result["checks"],
                           "footprint_overlap_ratio": geo_result["footprint_overlap_ratio"]}

    # ---- Stage 3: Selecting Workflow ----------------------------------------------------
    tasks = logger.run(
        "workflow_selection", "TaskRouter / WorkflowPlanner", qu["intent"],
        lambda: classify_tasks(mission.mode, qu),
    )

    # ---- Stage 4: Selecting Specialist Services -----------------------------------------
    selected_models = logger.run(
        "service_selection", "ModelRegistryService",
        f"primary_task={tasks['primary_task']}",
        lambda: select_services(db, tasks),
    )
    mission.workflow = {**tasks, "selected_models": selected_models}

    # ---- Stage 5: Executing Analysis ----------------------------------------------------
    change_output = None
    cross_modal_output = None
    vqa_output = None
    caption = None
    grounding_output = None
    landcover_stats = None

    if mission.mode == "bi_temporal":
        t1, t2 = observations
        change_output = logger.run(
            "workflow_execution", "ChangeAnalysisService", f"{t1.name} -> {t2.name}",
            lambda: change_analysis.run_change_analysis(
                STATIC_DIR / t1.image_path, STATIC_DIR / t2.image_path, IMG_SIZE, region["bbox"], t1.resolution_m,
            ),
        )
        if "spatial_grounding" in tasks["supporting_tasks"]:
            logger.run(
                "workflow_execution", "GroundingService (change hotspots)",
                f"{len(change_output['hotspots'])} candidate region(s)",
                lambda: {"hotspots": change_output["hotspots"]},
            )

    elif mission.mode in ("optical_sar", "region_centric"):
        optical, sar = observations
        cross_modal_output = logger.run(
            "workflow_execution", "CrossModalAnalysisService", f"{optical.name} + {sar.name}",
            lambda: cross_modal_analysis.run_cross_modal_analysis(
                STATIC_DIR / optical.image_path, STATIC_DIR / sar.image_path, IMG_SIZE, region["bbox"], optical.resolution_m,
            ),
        )

    elif mission.mode == "single_image":
        obs = observations[0]
        landcover_stats = logger.run(
            "workflow_execution", "SatQuery-BuiltUp-Classifier / land-cover thresholding", obs.name,
            lambda: compute_landcover_stats(STATIC_DIR / obs.image_path),
        )
        caption = logger.run(
            "workflow_execution", "CaptioningService", "land-cover percentages",
            lambda: generate_caption(landcover_stats["percentages"]),
        )
        vqa_output = logger.run(
            "workflow_execution", "VQAService", mission.query_text,
            lambda: answer_vqa(mission.query_text, landcover_stats["percentages"], landcover_stats),
        )
        if tasks["primary_task"] == "grounding":
            grounding_output = logger.run(
                "workflow_execution", "GroundingService", mission.query_text,
                lambda: ground_query(mission.query_text, landcover_stats["classes"], IMG_SIZE, region["bbox"]),
            )

    # ---- Stage 6: Aggregating Evidence ---------------------------------------------------
    def _aggregate():
        items = []
        if change_output:
            items += evidence_svc.build_evidence_bi_temporal(change_output, observations[0].id, observations[1].id)
        if cross_modal_output:
            items += evidence_svc.build_evidence_cross_modal(cross_modal_output, observations[0].id, observations[1].id)
        if landcover_stats:
            items += evidence_svc.build_evidence_single_image(landcover_stats, caption, observations[0].id, grounding_output)
        return items

    evidence_dicts = logger.run("evidence_aggregation", "EvidenceAggregationService",
                                 tasks["primary_task"], _aggregate)

    evidence_rows = []
    for item in evidence_dicts:
        row = Evidence(mission_id=mission.id, **item)
        db.add(row)
        evidence_rows.append(row)
    db.flush()

    # ---- Stage 7: Validating Evidence -----------------------------------------------------
    evidence_validation = logger.run(
        "evidence_validation", "EvidenceValidationService / ConflictDetectionService",
        f"{len(evidence_dicts)} evidence item(s)",
        lambda: evidence_svc.validate_evidence(evidence_dicts),
    )

    # ---- Stage 8: Estimating Confidence -----------------------------------------------------
    confidence = logger.run(
        "confidence_estimation", "ConfidenceService", evidence_validation["status"],
        lambda: confidence_svc.estimate_confidence(
            evidence_dicts, input_result["checks"], geo_result["checks"],
            geo_result["footprint_overlap_ratio"], cross_modal_output, evidence_validation["status"],
        ),
    )
    mission.confidence = confidence

    # ---- Stage 9: Generating Evidence-Grounded Answer ---------------------------------------
    def _assemble_answer():
        key_findings = []
        uncertainty = list(tasks.get("limitations", []))
        sensor_consistency = None

        if change_output:
            answer = (
                f"Built-up area increased by {change_output['builtup_growth_ha']} ha "
                f"({change_output['percent_area_changed']}% of the scene) between the two observation dates, "
                f"concentrated in {len(change_output['hotspots'])} hotspot region(s)."
                if change_output["has_significant_change"]
                else "No significant built-up change was detected between the two observation dates."
            )
            key_findings.append(f"Built-up growth: {change_output['builtup_growth_ha']} ha")
            key_findings.append(f"Built-up loss: {change_output['builtup_loss_ha']} ha")
            key_findings.append(f"Vegetation share T1->T2: {change_output['landcover_t1']['vegetation']}% -> {change_output['landcover_t2']['vegetation']}%")
            if not change_output["hotspots"]:
                uncertainty.append("No spatial hotspot cleared the minimum cluster threshold; change is diffuse.")

        elif cross_modal_output:
            level = cross_modal_output["consistency_level"]
            sensor_consistency = {
                "level": level,
                "optical_interpretation": cross_modal_output["optical_interpretation"],
                "sar_interpretation": cross_modal_output["sar_interpretation"],
                "conflict_ratio": cross_modal_output["conflict_ratio"],
                "disputed_area_ha": cross_modal_output["disputed_area_ha"],
            }
            if level == "CONFLICT_DETECTED":
                answer = (
                    f"Optical and SAR observations disagree over {cross_modal_output['disputed_area_ha']} ha: "
                    f"optical reflectance reads this area as water-like, but SAR backscatter does not support "
                    f"an open-water interpretation there. {cross_modal_output['confirmed_water_area_ha']} ha of "
                    f"water elsewhere in the scene IS confirmed by both sensors."
                )
                uncertainty.append("Cross-sensor conflict detected -- see Sensor Consistency panel before relying on the disputed region.")
            else:
                answer = (
                    f"Optical and SAR observations agree: {cross_modal_output['confirmed_water_area_ha']} ha of "
                    f"open water is confirmed by both sensors."
                )
            key_findings.append(f"Confirmed water extent: {cross_modal_output['confirmed_water_area_ha']} ha")
            key_findings.append(f"Sensor consistency: {level.replace('_', ' ').title()}")

        elif vqa_output:
            answer = vqa_output["answer"]
            key_findings.append(caption)
            if grounding_output and grounding_output["regions"]:
                key_findings.append(f"Grounded '{grounding_output['target_class']}' to {len(grounding_output['regions'])} region(s).")
            elif tasks["primary_task"] == "grounding":
                uncertainty.append("Grounding was requested but no matching region was confidently localized.")
        else:
            answer = "No analysis output was produced for this configuration."
            uncertainty.append("Unhandled mode/task combination.")

        if evidence_validation["status"] != "SUPPORTED":
            uncertainty.extend(evidence_validation["notes"])

        return {
            "answer": answer,
            "key_findings": key_findings,
            "uncertainty": uncertainty,
            "evidence_validation": evidence_validation,
            "sensor_consistency": sensor_consistency,
            "demo_label": "DEMO / PROTOTYPE OUTPUT",
        }

    result = logger.run("answer_generation", "AnswerAssemblyService", "final synthesis", _assemble_answer)
    mission.result = result
    mission.status = "completed"
    db.commit()
    db.refresh(mission)
    return mission
