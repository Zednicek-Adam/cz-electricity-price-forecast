# Output of the analysis scripts

## `01_explore.py`

```
=== data sanity ===
rows: 61368 range: 2018-01-01 00:00:00 -> 2024-12-31 23:00:00
missing hours: 0
NaNs:
 el_price      0
gen           0
load          0
gen_lag24    24

=== correlation (whole 2018-2024 sample) ===
           el_price     gen    load  gen_lag24
el_price     1.0000  0.1701  0.1258     0.1179
gen          0.1701  1.0000  0.7216     0.7034
load         0.1258  0.7216  1.0000     0.6223
gen_lag24    0.1179  0.7034  0.6223     1.0000

=== is `gen` collinear with `load`? ===
  2018-2024: corr(gen,load)=0.7216  R2(gen ~ load + weekday)=0.5218  VIF=2.09
  2020-2024 (test period): corr(gen,load)=0.6898  R2(gen ~ load + weekday)=0.4773  VIF=1.91

=== golden-file metrics over the thesis test period ===
                                           file     MAE    RMSE   sMAPE   rMAE
    LEAR_forecast_datCZ_YT4_CW730_processed.csv 17.4744 30.4715 21.2496 0.6701
pred-ar-192_ext_dummy_hour_2025-12-09_13-52.csv 19.0907 32.6433 22.6136 0.7321
      pred-ar-192_ext_diff_2025-12-14_10-58.csv 19.1108 32.7131 22.9037 0.7329
           pred-ar-192_ext_2025-12-08_18-04.csv 19.4060 33.0940 23.0206 0.7442
          pred-ar_192_diff_2025-12-08_18-39.csv 19.4309 33.3745 23.0781 0.7451
        pred-ar-192_custom_2025-12-08_17-27.csv 19.5030 33.4224 23.0122 0.7479
       pred-ar-192-AIC_sel_2025-12-01_14-56.csv 19.7401 33.6002 23.0550 0.7570
        pred-ar_192_s_diff_2025-12-08_19-14.csv 20.5598 34.7231 24.4105 0.7884
     pred-ar-192_mlog_diff_2025-12-13_10-07.csv 21.6170 36.1507 26.3171 0.8290
          pred-ar-192_mlog_2025-12-13_09-54.csv 22.6174 37.8509 26.4426 0.8673
    pred-ar-192_asinh_diff_2025-12-13_10-04.csv 23.2545 38.4957 28.8191 0.8918
         pred-ar-192_asinh_2025-12-13_09-51.csv 24.9031 41.2254 29.0592 0.9550
                                 NAIVE (lag-24) 26.0771 44.8416 31.9740 1.0000
```

## `02b_probe.py` — which configuration generated each golden file

```
mean |port - golden| over 5 sampled days, EUR/MWh
     config  d  D  ar-192_ext  ar-192_ext_diff  ar-192-AIC_sel  ar-192_custom  ar_192_diff
gen+load+wd  0  0       5.296            4.085           9.373          7.594        8.960
gen+load+wd  1  0       4.767            0.000           7.837          5.298        6.265
gen+load+wd  0  1      21.011           20.308          22.691         19.507       18.737
   gen+load  0  0       0.000            4.767           4.535          3.124        5.243
   gen+load  1  0       4.242            5.517           5.026          1.866        1.618
   gen+load  0  1      20.740           20.022          22.499         19.326       18.646
    load+wd  0  0       3.674            2.782           7.694          5.934        7.455
    load+wd  1  0       4.077            1.199           7.022          4.467        5.216
    load+wd  0  1      21.624           20.970          23.073         19.855       18.664
    wd only  0  0       4.843            2.019           7.772          5.732        6.960
    wd only  1  0       5.213            1.158           7.808          5.225        5.637
    wd only  0  1      21.818           21.128          23.222         19.996       18.797
       none  0  0       3.124            5.298           3.482          0.000        2.367
       none  1  0       5.243            6.265           5.767          2.367        0.000
       none  0  1      21.569           20.871          23.006         19.790       18.647
```

## `06_validate_fast.py`

```
gen+load, d=0        max|fast-arx|=1.740e-10  max|fast-golden|=1.803e-10  fast=0.009s/day  arx=0.265s/day
none, d=0            max|fast-arx|=1.797e-10  max|fast-golden|=1.856e-10  fast=0.008s/day  arx=0.207s/day
none, d=1            max|fast-arx|=9.805e-13  max|fast-golden|=1.251e-12  fast=0.011s/day  arx=0.237s/day
gen+load+wd, d=1     max|fast-arx|=1.407e-12  max|fast-golden|=1.506e-12  fast=0.013s/day  arx=0.271s/day
gen+load, D=1        max|fast-arx|=1.273e-11  max|fast-golden|=0.000e+00  fast=0.013s/day  arx=0.231s/day
```

## `04_evaluate.py`

```
=== full test period 2020-01-01 .. 2024-12-31 (43 848 hours) ===
                                                 config     MAE    RMSE   sMAPE   rMAE
                                     Diff-AR-X: weekday 18.9809 32.6886 22.5737 0.7279
                              Diff-AR-X: load + weekday 19.0697 32.6688 22.8072 0.7313
                               Diff-AR-X: gen + weekday 19.0885 32.7355 22.8629 0.7320
Diff-AR-X: gen + load + weekday  [= thesis 'Diff-AR-X'] 19.1108 32.7131 22.9037 0.7329
                                 AR-X: gen(t-24) + load 19.2653 32.8882 22.8428 0.7388
                                             AR-X: load 19.3880 33.0735 23.0008 0.7435
                    AR-X: gen + load  [= thesis 'AR-X'] 19.4060 33.0940 23.0206 0.7442
                                              AR-X: gen 19.4595 33.2628 23.0417 0.7462
                                        AR-X: gen(t-24) 19.5001 33.4190 22.9889 0.7478
                                  AR-192 (no exogenous) 19.5030 33.4224 23.0122 0.7479

=== MAE by year ===
                                                         2020   2021   2022   2023   2024
AR-192 (no exogenous)                                   5.169 16.142 39.568 16.718 19.955
AR-X: gen                                               5.085 16.214 39.723 16.670 19.646
AR-X: load                                              5.117 16.243 39.218 16.558 19.843
AR-X: gen + load  [= thesis 'AR-X']                     5.112 16.256 39.374 16.630 19.697
AR-X: gen(t-24)                                         5.166 16.159 39.538 16.722 19.953
AR-X: gen(t-24) + load                                  5.109 16.078 38.985 16.515 19.677
Diff-AR-X: weekday                                      4.814 15.914 38.285 16.407 19.522
Diff-AR-X: gen + weekday                                4.867 15.928 38.302 16.730 19.653
Diff-AR-X: load + weekday                               4.899 15.917 38.187 16.727 19.656
Diff-AR-X: gen + load + weekday  [= thesis 'Diff-AR-X'] 4.907 15.929 38.203 16.849 19.703

=== Diebold-Mariano: is the first config genuinely more accurate? ===
(daily MAE loss differential; p < 0.05 => the gain is real, not noise)
  AR-X: gen + load  [= thesis 'AR-X']                  vs AR-X: load                               dMAE=+0.0180  DM=+0.553  p=0.7100  no difference
  AR-X: gen                                            vs AR-192 (no exogenous)                    dMAE=-0.0435  DM=-0.622  p=0.2671  no difference
  Diff-AR-X: gen + load + weekday  [= thesis 'Diff-AR-X'] vs Diff-AR-X: load + weekday                dMAE=+0.0410  DM=+1.571  p=0.9420  no difference
  Diff-AR-X: gen + weekday                             vs Diff-AR-X: weekday                       dMAE=+0.1076  DM=+2.351  p=0.9906  B better (p<0.05)
  AR-X: load                                           vs AR-192 (no exogenous)                    dMAE=-0.1150  DM=-1.892  p=0.0292  A better (p<0.05)
  Diff-AR-X: load + weekday                            vs Diff-AR-X: weekday                       dMAE=+0.0888  DM=+2.511  p=0.9940  B better (p<0.05)
  AR-X: gen + load  [= thesis 'AR-X']                  vs AR-192 (no exogenous)                    dMAE=-0.0970  DM=-1.375  p=0.0846  no difference
  AR-X: gen(t-24) + load                               vs AR-X: gen + load  [= thesis 'AR-X']      dMAE=-0.1407  DM=-1.727  p=0.0421  A better (p<0.05)
  AR-X: gen(t-24) + load                               vs AR-X: load                               dMAE=-0.1227  DM=-1.897  p=0.0289  A better (p<0.05)
  AR-X: gen(t-24) + load                               vs AR-192 (no exogenous)                    dMAE=-0.2377  DM=-2.771  p=0.0028  A better (p<0.05)

=== cost of dropping `gen`, headline framing ===
  AR-X: gen + load  [= thesis 'AR-X']
    MAE with gen    = 19.4060 EUR/MWh
    MAE without gen = 19.3880 EUR/MWh
    cost of dropping gen = -0.0180 EUR/MWh (-0.093% MAE)
  Diff-AR-X: gen + load + weekday  [= thesis 'Diff-AR-X']
    MAE with gen    = 19.1108 EUR/MWh
    MAE without gen = 19.0697 EUR/MWh
    cost of dropping gen = -0.0410 EUR/MWh (-0.215% MAE)
```
