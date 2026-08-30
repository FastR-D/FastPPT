"""Shared FastPPT domain contracts."""

from .version import API_VERSION, SCHEMA_VERSION, VERSION, __version__
from .v2 import (
    V2_COMPILER_VERSION,
    V2_MODES,
    V2_SCHEMA_VERSION,
    V2EditableLevel,
    CompiledPageIR,
    DesignConfirmationRequired,
    DesignSelectionStateMachine,
    DesignSnapshot,
    PageContractV2,
    PackageHashMismatch,
    ProtectedAssetConflict,
    StylePackageManifest,
    TemplateCapacityExceeded,
    TemplatePackageManifest,
    TemplateSkeletonSnapshot,
    V2ContractError,
    compile_page,
    compile_style_page,
    compile_template_page,
    create_design_snapshot,
    resolve_design_attributes,
)

__all__ = [
    "API_VERSION", "SCHEMA_VERSION", "VERSION", "__version__",
    "V2_SCHEMA_VERSION", "V2_COMPILER_VERSION", "V2_MODES", "V2EditableLevel",
    "V2ContractError", "DesignConfirmationRequired", "TemplateCapacityExceeded",
    "ProtectedAssetConflict", "PackageHashMismatch", "StylePackageManifest",
    "TemplatePackageManifest", "TemplateSkeletonSnapshot", "PageContractV2",
    "DesignSnapshot", "CompiledPageIR", "DesignSelectionStateMachine",
    "create_design_snapshot", "resolve_design_attributes", "compile_template_page",
    "compile_style_page", "compile_page",
]
