"""Stable FastPPT boundary around the vendored ppt-master kernel."""

from .adapter import ConversionRequest, ConversionResult, PptMasterAdapter
from fastppt_core.v2 import TemplateSkeletonSnapshot

__all__ = ["ConversionRequest", "ConversionResult", "PptMasterAdapter", "TemplateSkeletonSnapshot"]
