"""Role-specific structured output schemas and fail-closed validation."""

from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any


def _object(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    names = list(properties) if required is None else required
    return {"type": "object", "properties": properties, "required": names, "additionalProperties": False}


def _nullable(kind: str) -> dict[str, Any]:
    return {"type": [kind, "null"]}


def _array(item: dict[str, Any]) -> dict[str, Any]:
    return {"type": "array", "items": item}


_STRING = {"type": "string"}
_NUMBER = {"type": "number"}
_BOOLEAN = {"type": "boolean"}
_STRINGS = _array(_STRING)
_BOUNDS = _object({"x": _NUMBER, "y": _NUMBER, "width": _NUMBER, "height": _NUMBER, "unit": _STRING})
_FACT = _object({
    "factId": _STRING,
    "kind": _STRING,
    "value": _STRING,
    "normalizedValue": _STRING,
    "sourceDocumentId": _STRING,
    "sourceLocator": _STRING,
    "confidence": _NUMBER,
    "locked": _BOOLEAN,
})
_CONFLICT = _object({
    "conflictId": _STRING,
    "conflictKey": _STRING,
    "factIds": _STRINGS,
    "status": _STRING,
    "reason": _STRING,
})
_PAGE_DRAFT = _object({
    "pageDraftId": _STRING,
    "orderIndex": {"type": "integer"},
    "title": _STRING,
    "body": _STRING,
    "centralClaim": _STRING,
    "conclusion": _STRING,
    "factIds": _STRINGS,
    "verbatimText": _STRINGS,
    "visualSuggestion": _STRING,
    "pageType": _STRING,
    "sourceHashes": _STRINGS,
})
_IMPORTED_OBJECT = _object({
    "objectId": _STRING,
    "type": _STRING,
    "supportLevel": _STRING,
    "bounds": _BOUNDS,
    "text": _STRING,
})
_PAGE_COUNT = _object({
    "mode": _STRING,
    "value": _nullable("integer"),
    "exact": _nullable("integer"),
    "min": _nullable("integer"),
    "max": _nullable("integer"),
    "reason": _STRING,
})
_FACT_IMPACT = _object({"added": _STRINGS, "removed": _STRINGS, "changed": _STRINGS})
_VISUAL_DIRECTION = _object({
    "direction": _STRING,
    "layoutIntent": _STRING,
    "hierarchyStyle": _STRING,
    "notes": _STRING,
})
_LAYOUT_CANDIDATE = _object({"layout": _STRING, "reason": _STRING})
_IMAGE_TREATMENT = _object({"crop": _STRING, "fit": _STRING, "opacity": _NUMBER, "notes": _STRING})
_RECONSTRUCTION_OBJECT = _object({
    "objectId": _STRING,
    "sourceObjectId": _nullable("string"),
    "type": _STRING,
    "bounds": _BOUNDS,
    "zIndex": {"type": "integer"},
    "editableLevel": _STRING,
    "artifactId": _nullable("string"),
    "recognitionConfidence": _nullable("number"),
    "requiresUserConfirmation": _BOOLEAN,
    "text": _STRING,
})
_UNRESOLVED_ITEM = _object({"objectId": _STRING, "reason": _STRING, "requiresUserConfirmation": _BOOLEAN})
_QA_ISSUE = _object({"code": _STRING, "severity": _STRING, "message": _STRING, "pageId": _STRING, "objectId": _nullable("string"), "suggestion": _STRING})
_CHANGE_VALUE = {"anyOf": [_STRING, _NUMBER, _BOOLEAN, {"type": "null"}, _array(_STRING), _object({"artifactId": _STRING})]}
_PLAN_CHANGE = _object({
    "kind": _STRING,
    "target": _nullable("string"),
    "value": _CHANGE_VALUE,
    "factId": _nullable("string"),
    "constraint": _nullable("string"),
})
_PAGE_DELTA = _object({"add": _STRINGS, "remove": _STRINGS, "split": _STRINGS, "merge": _STRINGS})
_ESTIMATED_USAGE = _object({"imageUnits": {"type": "integer"}, "amount": _NUMBER, "currency": _STRING})


STAGE_OUTPUT_SCHEMAS: dict[str, dict[str, Any]] = {
    "source_analyst": _object({
        "summary": _STRING,
        "structure": _STRINGS,
        "factCandidates": _array(_FACT),
        "verbatimText": _STRINGS,
        "untrustedSourceInstructions": _STRINGS,
        "coverageHashes": _STRINGS,
        "uncertainties": _STRINGS,
    }),
    "import_analyst": _object({
        "summary": _STRING,
        "pageDrafts": _array(_PAGE_DRAFT),
        "importedObjects": _array(_IMPORTED_OBJECT),
        "editableBoundary": _STRING,
        "uncertainties": _STRINGS,
    }),
    "fact_reviewer": _object({
        "retainedFacts": _array(_FACT),
        "pendingFacts": _array(_FACT),
        "conflicts": _array(_CONFLICT),
        "recommendations": _STRINGS,
    }),
    "outline_planner": _object({
        "workflowMode": _STRING,
        "pageCount": _PAGE_COUNT,
        "audience": _STRING,
        "purpose": _STRING,
        "language": _STRING,
        "storyline": _STRINGS,
        "pageDrafts": _array(_PAGE_DRAFT),
        "factImpact": _FACT_IMPACT,
        "logicAnalysisArtifactIds": _STRINGS,
        "visualDirection": _VISUAL_DIRECTION,
        "requiresConfirmation": _BOOLEAN,
        "confirmationReasons": _STRINGS,
    }),
    "content_logic_reviewer": _object({
        "logicType": _STRING,
        "logicEvidence": _STRINGS,
        "centralClaim": _STRING,
        "pageRhythm": _STRINGS,
        "densityLevel": _STRING,
        "layoutCandidates": _array(_LAYOUT_CANDIDATE),
        "persuasionNotes": _STRINGS,
        "uncertainties": _STRINGS,
    }),
    "page_writer": _object({
        "title": _STRING,
        "centralClaim": _STRING,
        "bodyParagraphs": _STRINGS,
        "conclusion": _STRING,
        "verbatimText": _STRINGS,
        "factIds": _STRINGS,
        "visualNotes": _STRING,
        "splitRecommended": _BOOLEAN,
        "uncertainties": _STRINGS,
    }),
    "visual_director": _object({
        "designMode": {"type": "string", "enum": ["none", "selected"]},
        "visualDirection": _STRING,
        "layoutIntent": _STRING,
        "hierarchyStyle": _STRING,
        "accentColor": _STRING,
        "backgroundColor": _STRING,
        "imageTreatment": _IMAGE_TREATMENT,
        "imagePromptCandidate": _STRING,
        "reservedCapabilities": _STRINGS,
    }),
    "reconstruction_planner": _object({
        "objects": _array(_RECONSTRUCTION_OBJECT),
        "unresolvedItems": _array(_UNRESOLVED_ITEM),
        "editableBoundary": _STRING,
    }),
    "qa_reviewer": _object({
        "passed": _BOOLEAN,
        "issues": _array(_QA_ISSUE),
        "recommendations": _STRINGS,
    }),
    "edit_planner": _object({
        "workflowMode": _STRING,
        "targetScope": _STRING,
        "affectedPageIds": _STRINGS,
        "changes": _array(_PLAN_CHANGE),
        "pageDelta": _PAGE_DELTA,
        "factImpact": _FACT_IMPACT,
        "unsupported": _STRINGS,
        "requiresConfirmation": _BOOLEAN,
        "confirmationReasons": _STRINGS,
        "estimatedUsage": _ESTIMATED_USAGE,
    }),
}


def _snake_case(name: str) -> str:
    """Return the internal snake_case alias for a provider field name."""

    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def _validate_schema(value: Any, schema: dict[str, Any], path: str, errors: list[str], *, strict: bool) -> None:
    """Validate a provider result recursively without importing jsonschema.

    Providers use the public camelCase contract while older deterministic
    fixtures and runtime records use snake_case. Object keys are therefore
    matched by exact name first and then by their unambiguous snake_case alias;
    the returned payload is deliberately left untouched so provenance retains
    the exact provider response.
    """

    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        branch_errors: list[list[str]] = []
        for branch in any_of:
            if not isinstance(branch, dict):
                continue
            candidate: list[str] = []
            _validate_schema(value, branch, path, candidate, strict=strict)
            if not candidate:
                return
            branch_errors.append(candidate)
        errors.append(f"{path} does not match any allowed schema")
        return

    expected = schema.get("type")
    expected_types = expected if isinstance(expected, list) else [expected] if expected else []
    if expected_types:
        matched = False
        for expected_type in expected_types:
            if expected_type == "null" and value is None:
                matched = True
            elif expected_type == "string" and isinstance(value, str):
                matched = True
            elif expected_type == "boolean" and isinstance(value, bool):
                matched = True
            elif expected_type == "integer" and isinstance(value, int) and not isinstance(value, bool):
                matched = True
            elif expected_type == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
                matched = True
            elif expected_type == "array" and isinstance(value, list):
                matched = True
            elif expected_type == "object" and isinstance(value, Mapping):
                matched = True
        if not matched:
            readable = " or ".join(str(item) for item in expected_types)
            errors.append(f"{path} must be {readable}")
            return

    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        errors.append(f"{path} is invalid")
        return

    if schema.get("type") == "object" and isinstance(value, Mapping):
        properties = schema.get("properties") or {}
        canonical: dict[str, Any] = {}
        for raw_key, child in value.items():
            raw_name = str(raw_key)
            if raw_name in properties:
                canonical_name = raw_name
            else:
                aliases = [name for name in properties if _snake_case(str(name)) == raw_name]
                canonical_name = aliases[0] if len(aliases) == 1 else None
            if canonical_name is None:
                if schema.get("additionalProperties") is False:
                    errors.append(f"{path}.{raw_name} is not allowed")
                elif isinstance(schema.get("additionalProperties"), dict):
                    _validate_schema(child, schema["additionalProperties"], f"{path}.{raw_name}", errors)
                continue
            if canonical_name in canonical:
                errors.append(f"{path}.{raw_name} duplicates {canonical_name}")
                continue
            canonical[canonical_name] = child
        # Deterministic v1.1 fixtures may omit nested fields, but real
        # Provider responses use the complete provider-facing contract.
        if strict or ("." not in path and "[" not in path):
            for required in schema.get("required") or []:
                if required not in canonical:
                    errors.append(f"{path}.{required} is required")
        for key, child in canonical.items():
            child_schema = properties.get(key)
            if isinstance(child_schema, dict):
                _validate_schema(child, child_schema, f"{path}.{key}", errors, strict=strict)
        return

    if schema.get("type") == "array" and isinstance(value, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, child in enumerate(value):
                _validate_schema(child, item_schema, f"{path}[{index}]", errors, strict=strict)


def validate_stage_output(role: str, value: Any, *, strict: bool = False) -> dict[str, Any]:
    """Validate one role output; production callers should enable strict mode."""
    schema = STAGE_OUTPUT_SCHEMAS.get(role)
    if schema is None:
        if not isinstance(value, Mapping):
            raise ValueError("Agent output must be an object")
        return dict(value)
    if not isinstance(value, Mapping):
        raise ValueError(f"{role} output must be an object")
    errors: list[str] = []
    _validate_schema(value, schema, role, errors, strict=strict)
    if errors:
        raise ValueError(f"{role} output contract violation ({'; '.join(errors[:8])})")
    return dict(value)
