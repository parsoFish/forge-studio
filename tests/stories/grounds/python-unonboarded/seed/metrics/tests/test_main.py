import sys
import os
import pytest

# Add src to path so we can import main
sys.path.append(os.path.join(os.path.dirname(__file__), '../src'))

from main import DUMMY_METRIC

def test_dummy_metric_initialization():
    """Verify that the dummy metric is initialized correctly."""
    assert DUMMY_METRIC._name == 'gitweave_dummy_metric'
    assert DUMMY_METRIC._documentation == 'A dummy metric for testing'
