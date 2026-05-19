# Prediction Methodology

## Purpose

The prediction layer in ZIF Biocomposite Explorer provides model-derived estimates for unsampled points within the experimentally supported ZIF biocomposite composition domain. The predictions are intended for visual exploration and hypothesis generation, not as confirmed experimental measurements.

## Input features

The prediction model uses synthesis descriptors derived from the loaded experimental dataset:

- metal precursor percentage
- ligand percentage
- synthesis concentration
- washing condition encoded as ethanol or water
- metal-to-ligand ratio
- log-transformed concentration

BSA percentage is not used directly in the classifier feature vector because the ternary composition components are constrained by metal + ligand + BSA = 100. Keeping all three composition percentages would introduce redundancy. BSA is still retained in the app as a displayed composition coordinate and as part of the experimentally supported domain check.

## Phase classification

Phase prediction is performed using a soft-voting ensemble of Random Forest and ExtraTrees classifiers when scikit-learn is available. Both classifiers are trained on the engineered feature space and use balanced class weighting to reduce bias toward more frequent phases.

The ensemble returns phase-probability-like scores for the supported ZIF phase labels. These scores should be interpreted as model-derived phase-contribution likelihoods for visual exploration, not as experimentally confirmed phase fractions.

If scikit-learn is unavailable, the app falls back to a nearest-neighbour phase-classification prototype.

## Continuous-property prediction

Continuous properties are estimated using inverse-distance weighted nearest-neighbour regression. This is used for encapsulation efficiency, loading capacity, crystalline fraction, amorphous fraction, and ATR-ratio descriptors where values are available.

This local regression strategy was chosen because the dataset is small and some continuous labels are incomplete. Nearest-neighbour averaging allows predictions to be based only on available neighbouring values while preserving local smoothness in synthesis space.

## Trust and domain handling

Predictions are restricted to the experimentally supported composition and concentration ranges. Queries outside this supported domain are rejected.

The app reports a distance-based trust band calculated from nearest-neighbour distances in the scaled feature space. Distances are grouped into near known data, moderate extrapolation, and far from measured data using thresholds calibrated from the training dataset.

Low-data phase warnings are also shown for phases represented by fewer training examples.

## Interpretation

The prediction layer should be used as an exploratory guide for navigating the synthesis space. It is useful for identifying regions that may be worth inspecting or testing, but it does not replace experimental synthesis, PXRD analysis, or expert interpretation.

The visualised prediction grid is therefore best understood as a model-derived map over the experimentally supported region of the dataset.
