import numpy as np
import pytest

from process import deaccumulate_mm


def test_known_series_gives_expected_mm():
    # accumulated metres at steps 0, 3, 6, 9, 12 h
    acc_m = np.array([0.0, 0.002, 0.0025, 0.0025, 0.0105])
    expected_mm = np.array([2.0, 0.5, 0.0, 8.0])
    np.testing.assert_allclose(deaccumulate_mm(acc_m), expected_mm, atol=1e-9)


def test_packing_dip_gives_no_negatives_and_keeps_total():
    # 0.0030 -> 0.0029999 is a packing artefact; it must not produce negative rain
    acc_m = np.array([0.0, 0.0030, 0.0029999, 0.0050])
    rain = deaccumulate_mm(acc_m)
    assert (rain >= 0).all()
    np.testing.assert_allclose(rain, [3.0, 0.0, 2.0], atol=1e-9)
    assert rain.sum() == pytest.approx(acc_m.max() * 1000)


def test_grid_axis_and_sum_back_to_total():
    rng = np.random.default_rng(0)
    acc_m = np.cumsum(rng.uniform(0, 0.004, size=(10, 3, 4)), axis=0)
    rain = deaccumulate_mm(acc_m, axis=0)
    assert rain.shape == (9, 3, 4)
    assert (rain >= 0).all()
    np.testing.assert_allclose(rain.sum(axis=0), (acc_m[-1] - acc_m[0]) * 1000)
