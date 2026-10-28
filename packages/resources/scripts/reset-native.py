#!/usr/bin/env python3
"""Repeat native conversion over every resource and animation reference page.
Includes excluded pages, leaves source PPTX and catalog metadata untouched.
First conversion is conservative; reruns keep native objects and annotated SVG fallbacks.
"""
import pathlib,runpy,sys
SCRIPT=pathlib.Path(__file__).with_name('native-html.py')
if __name__=='__main__':runpy.run_path(str(SCRIPT),run_name='__main__')
