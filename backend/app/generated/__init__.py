"""Generated protobuf stubs for SolProbe.

This package contains auto-generated protobuf and gRPC stubs.
The sys.path manipulation ensures that intra-package imports
(e.g., `import metrics_pb2` inside `alerts_pb2.py`) resolve correctly.
"""
import os
import sys

# Add this directory to sys.path so generated code can resolve bare imports
# like `import metrics_pb2` from within `alerts_pb2.py`.
_generated_dir = os.path.dirname(os.path.abspath(__file__))
if _generated_dir not in sys.path:
    sys.path.insert(0, _generated_dir)
