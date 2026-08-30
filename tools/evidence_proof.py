"""Authenticated proofs for release evidence records.

The provider evidence files are intentionally redacted, so the release gate
needs a small authenticity primitive in addition to structural validation.  A
key is supplied explicitly by the operator or CI environment and is never
included in the evidence record.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any


PROOF_VERSION = "1.0"
PROOF_ISSUER = "fastppt-runtime"


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _key_bytes(signing_key: str | bytes | None) -> bytes | None:
    if signing_key is None:
        return None
    if isinstance(signing_key, bytes):
        return signing_key if signing_key else None
    value = str(signing_key)
    return value.encode("utf-8") if value else None


def evidence_digest(record: dict[str, Any]) -> str:
    """Hash the evidence content without the proof or loader-only metadata."""

    unsigned = {
        key: value
        for key, value in record.items()
        if key != "runtime_proof" and not str(key).startswith("_")
    }
    return "sha256:" + hashlib.sha256(_canonical_bytes(unsigned)).hexdigest()


def _proof_payload(binding_digest: str, digest: str) -> dict[str, str]:
    return {
        "version": PROOF_VERSION,
        "issuer": PROOF_ISSUER,
        "binding_digest": binding_digest,
        "evidence_digest": digest,
    }


def sign_evidence_record(record: dict[str, Any], signing_key: str | bytes) -> dict[str, Any]:
    """Return a copy of *record* carrying an HMAC runtime proof."""

    key = _key_bytes(signing_key)
    if key is None:
        raise ValueError("FASTPPT_RELEASE_EVIDENCE_HMAC_KEY is required")
    binding_digest = str(record.get("binding_digest") or "")
    if not binding_digest:
        raise ValueError("Evidence binding_digest is required before signing")
    digest = evidence_digest(record)
    payload = _proof_payload(binding_digest, digest)
    signature = "hmac-sha256:" + hmac.new(key, _canonical_bytes(payload), hashlib.sha256).hexdigest()
    return {**record, "runtime_proof": {**payload, "signature": signature}}


def validate_runtime_proof(record: dict[str, Any], signing_key: str | bytes | None) -> list[str]:
    """Validate the proof against an explicitly trusted key."""

    errors: list[str] = []
    proof = record.get("runtime_proof")
    if not isinstance(proof, dict):
        return ["runtime_proof_missing"]
    if _key_bytes(signing_key) is None:
        return ["runtime_proof_trusted_key_missing"]
    if proof.get("version") != PROOF_VERSION:
        errors.append("runtime_proof_version_unsupported")
    if proof.get("issuer") != PROOF_ISSUER:
        errors.append("runtime_proof_issuer_invalid")
    binding_digest = record.get("binding_digest")
    if proof.get("binding_digest") != binding_digest:
        errors.append("runtime_proof_binding_mismatch")
    expected_digest = evidence_digest(record)
    if proof.get("evidence_digest") != expected_digest:
        errors.append("runtime_proof_evidence_digest_mismatch")
    signature = proof.get("signature")
    if not isinstance(signature, str) or not signature.startswith("hmac-sha256:"):
        errors.append("runtime_proof_signature_missing")
    else:
        payload = _proof_payload(str(proof.get("binding_digest") or ""), str(proof.get("evidence_digest") or ""))
        expected_signature = "hmac-sha256:" + hmac.new(_key_bytes(signing_key) or b"", _canonical_bytes(payload), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_signature):
            errors.append("runtime_proof_signature_invalid")
    return errors
