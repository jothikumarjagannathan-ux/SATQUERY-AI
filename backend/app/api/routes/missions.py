from __future__ import annotations

import io
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from sqlalchemy.orm import Session

from app.db.models import Evidence, ExecutionStep, Mission, Observation
from app.db.session import get_db
from app.demo_data.generate_imagery import IMG_SIZE, STATIC_DIR
from app.demo_data.scenarios import REGIONS
from app.orchestration.orchestrator import PipelineError, run_mission_pipeline
from app.schemas.schemas import (
    AnalyzeRequest,
    EvidenceOut,
    ExecutionStepOut,
    FeedbackRequest,
    KnowledgeGraphOut,
    MissionDetailOut,
    MissionSummaryOut,
    UnderstandQueryRequest,
    ValidateInputsRequest,
)
from app.services.geo_utils import bbox_polygon
from app.services.input_validation import validate_geospatial, validate_inputs
from app.services.knowledge_graph import build_knowledge_graph
from app.services.query_understanding import understand_query

router = APIRouter(prefix="/api", tags=["missions"])


def _mission_detail(db: Session, mission: Mission) -> MissionDetailOut:
    region = REGIONS.get(
        mission.region_key,
        {
            "key": mission.region_key,
            "label": f"User Upload — {mission.title}",
            "description": "User-uploaded observation analyzed via SatQuery AI pipeline.",
            "bbox": [77.101, 15.602, 77.151, 15.652],
            "modes": [mission.mode],
        },
    )
    observations = db.query(Observation).filter(Observation.region_key == mission.region_key).all()
    evidence_items = db.query(Evidence).filter(Evidence.mission_id == mission.id).all()
    steps = (
        db.query(ExecutionStep)
        .filter(ExecutionStep.mission_id == mission.id)
        .order_by(ExecutionStep.step_index)
        .all()
    )
    return MissionDetailOut(
        id=mission.id, title=mission.title, query_text=mission.query_text, mode=mission.mode,
        region_key=mission.region_key, status=mission.status, is_demo=mission.is_demo, saved=mission.saved,
        created_at=mission.created_at, updated_at=mission.updated_at,
        result=mission.result, confidence=mission.confidence, workflow=mission.workflow,
        query_understanding=mission.query_understanding, validation=mission.validation,
        region={"key": mission.region_key, **region},
        observations=observations, evidence_items=evidence_items, execution_steps=steps,
    )


@router.post("/understand-query")
def api_understand_query(req: UnderstandQueryRequest):
    return understand_query(req.query_text)


@router.post("/validate-inputs")
def api_validate_inputs(req: ValidateInputsRequest, db: Session = Depends(get_db)):
    obs = db.query(Observation).filter(Observation.region_key == req.region_key).all()
    role_sets = {
        "bi_temporal": {"before", "after"},
        "optical_sar": {"optical", "sar"},
        "region_centric": {"optical", "sar"},
        "single_image": {"single"},
    }
    needed = role_sets.get(req.mode, set())
    relevant = [o for o in obs if o.role in needed]
    if len(relevant) < len(needed):
        return {
            "checks": [{"key": "availability", "label": "Required observations available", "status": False,
                        "detail": f"Region '{req.region_key}' does not provide the observation roles {needed} needed for '{req.mode}'."}],
            "observations_count": len(relevant),
            "overall_status": False,
        }
    input_result = validate_inputs(relevant)
    geo_result = validate_geospatial(relevant)
    all_checks = input_result["checks"] + geo_result["checks"]
    return {
        "checks": all_checks,
        "observations_count": len(relevant),
        "overall_status": all(c["status"] for c in all_checks),
        "footprint_overlap_ratio": geo_result.get("footprint_overlap_ratio"),
    }


@router.post("/analyze", response_model=MissionDetailOut)
def api_analyze(req: AnalyzeRequest, db: Session = Depends(get_db)):
    if req.region_key not in REGIONS:
        raise HTTPException(404, f"Unknown region '{req.region_key}'")

    mission = Mission(
        title=req.title or f"{REGIONS[req.region_key]['label']} — {req.mode.replace('_', ' ').title()}",
        query_text=req.query_text, mode=req.mode, region_key=req.region_key, status="running",
    )
    db.add(mission)
    db.commit()
    db.refresh(mission)

    try:
        run_mission_pipeline(db, mission)
    except PipelineError as exc:
        raise HTTPException(400, str(exc))

    return _mission_detail(db, mission)


@router.post("/upload-and-analyze", response_model=MissionDetailOut)
async def api_upload_and_analyze(
    file: UploadFile = File(...),
    query_text: str = Form("Describe this scene and analyze land-cover composition."),
    title: str | None = Form(None),
    mode: str = Form("single_image"),
    file_after: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    STATIC_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Read & process primary image
    content = await file.read()
    try:
        img = Image.open(io.BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(400, f"Invalid image file: {exc}")

    img_resized = img.resize((IMG_SIZE, IMG_SIZE), Image.Resampling.LANCZOS)
    filename = f"upload_{uuid.uuid4().hex[:10]}.png"
    img_resized.save(STATIC_DIR / filename, format="PNG")

    # 2. Register dynamic region for this upload
    region_key = f"upload-region-{uuid.uuid4().hex[:8]}"
    clean_title = (title or "").strip()
    upload_title = clean_title if clean_title else f"Upload Analysis — {file.filename or 'Custom Image'}"

    actual_mode = "bi_temporal" if file_after else "single_image"
    if mode == "bi_temporal" and not file_after:
        actual_mode = "single_image"

    REGIONS[region_key] = {
        "label": upload_title,
        "description": f"User-uploaded observation ({file.filename}) analyzed via SatQuery AI pipeline.",
        "bbox": [77.101, 15.602, 77.151, 15.652],
        "modes": [actual_mode],
    }

    # 3. Create Mission
    mission = Mission(
        title=upload_title,
        query_text=query_text.strip() or "Describe this scene and analyze land-cover composition.",
        mode=actual_mode,
        region_key=region_key,
        status="running",
        is_demo=False,
    )
    db.add(mission)
    db.commit()
    db.refresh(mission)

    now = datetime.now(timezone.utc)
    obs1 = Observation(
        mission_id=mission.id,
        region_key=region_key,
        name=file.filename or "Uploaded Observation",
        sensor_type="optical",
        modality="multispectral (RGB)",
        role="single" if not file_after else "before",
        acquisition_time=now - timedelta(days=365) if file_after else now,
        crs="EPSG:4326",
        resolution_m=10.0,
        bands=["Red", "Green", "Blue"],
        footprint_geometry=bbox_polygon(REGIONS[region_key]["bbox"]),
        preprocessing="User upload (normalized RGB)",
        image_path=filename,
        width=IMG_SIZE,
        height=IMG_SIZE,
    )
    db.add(obs1)

    if file_after:
        content2 = await file_after.read()
        try:
            img2 = Image.open(io.BytesIO(content2)).convert("RGB")
        except Exception as exc:
            raise HTTPException(400, f"Invalid secondary image file: {exc}")
        img2_resized = img2.resize((IMG_SIZE, IMG_SIZE), Image.Resampling.LANCZOS)
        filename2 = f"upload_{uuid.uuid4().hex[:10]}.png"
        img2_resized.save(STATIC_DIR / filename2, format="PNG")

        obs2 = Observation(
            mission_id=mission.id,
            region_key=region_key,
            name=file_after.filename or "Uploaded Observation (T2)",
            sensor_type="optical",
            modality="multispectral (RGB)",
            role="after",
            acquisition_time=now,
            crs="EPSG:4326",
            resolution_m=10.0,
            bands=["Red", "Green", "Blue"],
            footprint_geometry=bbox_polygon(REGIONS[region_key]["bbox"]),
            preprocessing="User upload (normalized RGB)",
            image_path=filename2,
            width=IMG_SIZE,
            height=IMG_SIZE,
        )
        db.add(obs2)

    db.commit()

    try:
        run_mission_pipeline(db, mission)
    except PipelineError as exc:
        raise HTTPException(400, str(exc))

    return _mission_detail(db, mission)


@router.get("/missions", response_model=list[MissionSummaryOut])
def api_list_missions(db: Session = Depends(get_db)):
    return db.query(Mission).order_by(Mission.created_at.desc()).all()


@router.get("/missions/{mission_id}", response_model=MissionDetailOut)
def api_get_mission(mission_id: str, db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")
    return _mission_detail(db, mission)


@router.patch("/missions/{mission_id}/feedback", response_model=MissionSummaryOut)
def api_update_feedback(mission_id: str, req: FeedbackRequest, db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")
    if req.saved is not None:
        mission.saved = req.saved
    if req.user_feedback is not None:
        mission.user_feedback = req.user_feedback
    db.commit()
    db.refresh(mission)
    return mission


@router.get("/evidence/{mission_id}", response_model=list[EvidenceOut])
def api_get_evidence(mission_id: str, db: Session = Depends(get_db)):
    return db.query(Evidence).filter(Evidence.mission_id == mission_id).all()


@router.get("/knowledge-graph/{mission_id}", response_model=KnowledgeGraphOut)
def api_knowledge_graph(mission_id: str, db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")
    observations = db.query(Observation).filter(Observation.region_key == mission.region_key).all()
    evidence_items = db.query(Evidence).filter(Evidence.mission_id == mission_id).all()
    return build_knowledge_graph(mission, observations, evidence_items)


@router.post("/report/{mission_id}")
def api_generate_report(mission_id: str, db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")
    detail = _mission_detail(db, mission)
    lines = [
        f"# SatQuery AI — Mission Report", "",
        f"**DEMO / PROTOTYPE OUTPUT** — synthetic demo imagery, deterministic prototype analysis services.", "",
        f"- Mission: {mission.title}", f"- Query: {mission.query_text}", f"- Mode: {mission.mode}",
        f"- Region: {detail.region['label']}", f"- Status: {mission.status}",
        f"- Generated: {mission.updated_at.isoformat()}", "",
        "## AI Assessment", "", (mission.result or {}).get("answer", ""), "",
        "## Key Findings", "",
    ]
    for kf in (mission.result or {}).get("key_findings", []):
        lines.append(f"- {kf}")
    lines += ["", "## Uncertainty / Limitations", ""]
    for u in (mission.result or {}).get("uncertainty", []):
        lines.append(f"- {u}")
    lines += ["", "## Confidence Breakdown", ""]
    conf = mission.confidence or {}
    lines.append(f"Overall: {conf.get('overall_percent')}% ({conf.get('label')})")
    for k, v in (conf.get("components") or {}).items():
        lines.append(f"- {k.replace('_', ' ').title()}: {v}")
    lines += ["", "## Evidence", ""]
    for e in detail.evidence_items:
        lines.append(f"- [{e.validation_status.upper()}] {e.title}: {e.description}")
    report_text = "\n".join(lines)
    return {"mission_id": mission_id, "format": "markdown", "content": report_text}
