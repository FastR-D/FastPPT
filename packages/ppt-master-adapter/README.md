# ppt-master Adapter

This is the only application-facing boundary for the vendored `ppt-master`
kernel in `kernel/ppt-master/upstream`. It provides capability probing,
controlled SVG copies, editable PPTX conversion, SVG/PPTX QA, full-slide
raster rejection, atomic publication, timeouts, and stable error mapping.

Application and service code must import `fastppt_ppt_master`; it must never
depend on kernel script paths or parse kernel CLI output itself.
