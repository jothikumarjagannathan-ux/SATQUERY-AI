"""KnowledgeGraphService -- builds the interactive graph (Innovation 4) from the
actual mission record: real observations, real evidence, real computed metrics.
Nothing here is a decorative static diagram.
"""

from __future__ import annotations

from app.db.models import Evidence, Mission, Observation
from app.db.session import SessionLocal
from app.demo_data.scenarios import EXTERNAL_SIGNAL, OPTICAL_SAR, REGIONS
from app.services.correlation import correlate_external_signal


def build_knowledge_graph(mission: Mission, observations: list[Observation], evidence_items: list[Evidence]) -> dict:
    region = REGIONS.get(
        mission.region_key,
        {
            "label": mission.title,
            "description": "User-uploaded observation analyzed with SatQuery AI.",
            "bbox": [77.101, 15.602, 77.151, 15.652],
        },
    )
    nodes = []
    edges = []

    region_node_id = f"region:{mission.region_key}"
    nodes.append({
        "id": region_node_id, "type": "region", "label": region["label"],
        "detail": {"description": region["description"], "bbox": region["bbox"]},
    })

    for obs in observations:
        node_id = f"observation:{obs.id}"
        nodes.append({
            "id": node_id, "type": "observation",
            "label": f"{obs.sensor_type.upper()} · {obs.acquisition_time.date()}",
            "detail": {
                "name": obs.name, "sensor_type": obs.sensor_type, "modality": obs.modality,
                "acquisition_time": obs.acquisition_time.isoformat(), "role": obs.role,
                "resolution_m": obs.resolution_m, "model_or_tool": "Data & Metadata Store (catalog)",
            },
        })
        edges.append({
            "source": region_node_id, "target": node_id, "relationship": "has_observation",
            "detail": {"spatial_relationship": "within region footprint"},
        })

    result_node_id = f"result:{mission.id}"
    result = mission.result or {}
    workflow = mission.workflow or {}
    result_label = {
        "change_detection": "Detected Change", "cross_modal": "Cross-Modal Result",
        "vqa": "Scene Analysis", "captioning": "Scene Analysis", "grounding": "Grounded Region",
    }.get(workflow.get("primary_task"), "Analysis Result")

    nodes.append({
        "id": result_node_id, "type": "result", "label": result_label,
        "detail": {
            "produced_by": ", ".join(m["name"] for m in workflow.get("selected_models", [])) or "n/a",
            "primary_task": workflow.get("primary_task"),
            "confidence": (mission.confidence or {}).get("overall_percent"),
            "answer": result.get("answer"),
        },
    })
    for obs in observations:
        edges.append({
            "source": f"observation:{obs.id}", "target": result_node_id, "relationship": "produced_result",
            "detail": {"model_or_tool": ", ".join(m["name"] for m in workflow.get("selected_models", []))},
        })

    feature_keys = {"vegetation": "Vegetation", "water": "Water", "builtup": "Built-Up", "fallow_or_bare": "Fallow / Bare Soil"}
    seen_feature_nodes: set[str] = set()
    for ev in evidence_items:
        node_id = f"evidence:{ev.id}"
        nodes.append({
            "id": node_id, "type": "evidence", "label": ev.title,
            "detail": {
                "description": ev.description, "source_service": ev.source_service,
                "validation_status": ev.validation_status, "strength": ev.strength, "metrics": ev.metrics,
            },
        })
        edges.append({
            "source": result_node_id, "target": node_id, "relationship": "supported_by",
            "detail": {"evidence_type": ev.type, "validation_status": ev.validation_status},
        })

        metrics = ev.metrics or {}
        flat_values = {}
        for v in metrics.values():
            if isinstance(v, dict):
                flat_values.update(v)
        for key, label in feature_keys.items():
            if key in metrics or key in flat_values:
                fnode_id = f"feature:{key}"
                if fnode_id not in seen_feature_nodes:
                    nodes.append({"id": fnode_id, "type": "feature", "label": label, "detail": {}})
                    seen_feature_nodes.add(fnode_id)
                edges.append({
                    "source": node_id, "target": fnode_id, "relationship": "quantifies",
                    "detail": {"value": metrics.get(key, flat_values.get(key))},
                })

    # Innovation 2 tie-in: for the coastal wetland region, surface the external
    # observation + possible-association nodes automatically.
    if mission.region_key == OPTICAL_SAR["region_key"]:
        db = SessionLocal()
        try:
            from app.db.models import ExternalObservation
            ext_points = db.query(ExternalObservation).filter_by(region_key=mission.region_key).all()
            ambiguous = OPTICAL_SAR["layout"]["ambiguous_patch"]
            corr = correlate_external_signal(ext_points, (ambiguous["cx"], ambiguous["cy"]))
        finally:
            db.close()

        ext_node_id = "external:wading_bird_occurrence"
        nodes.append({
            "id": ext_node_id, "type": "external_signal", "label": "External Observation",
            "detail": {"source": EXTERNAL_SIGNAL["source"], "signal_type": EXTERNAL_SIGNAL["signal_type"]},
        })
        assoc_node_id = "association:wetland_signal"
        nodes.append({
            "id": assoc_node_id, "type": "association", "label": "Possible Association",
            "detail": {
                "support_level": corr["support_level"], "strength": corr["strength"],
                "narrative": corr["narrative"], "disclaimer": corr["disclaimer"],
            },
        })
        edges.append({
            "source": result_node_id, "target": ext_node_id, "relationship": "temporally_nearby",
            "detail": {"note": "Independent environmental signal, same region and time window."},
        })
        edges.append({
            "source": ext_node_id, "target": assoc_node_id, "relationship": "correlated_with",
            "detail": {"type": "correlation, not verified evidence", "strength": corr["strength"]},
        })
        edges.append({
            "source": result_node_id, "target": assoc_node_id, "relationship": "possible_association",
            "detail": {"type": "correlation, not verified evidence"},
        })

    return {"mission_id": mission.id, "nodes": nodes, "edges": edges}
