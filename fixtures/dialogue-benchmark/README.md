# Dialogue benchmark corpus

This directory contains the small, redistributable source corpus for PLVS's programme-dialogue
evaluation. Generated programme WAV files are deliberately not committed: run
`npm run benchmark:dialogue:fixtures` to create them under `artifacts/dialogue-benchmark/corpus/`
together with a resolved manifest and output hashes.

The four speech clips come from the LibriSpeech ASR corpus (OpenSLR SLR12), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). LibriSpeech was prepared by Vassil
Panayotov, Guoguo Chen, Daniel Povey, and Sanjeev Khudanpur from LibriVox public-domain
audiobooks. The canonical corpus page is <https://www.openslr.org/12>.

| File | Split | Transcript | SHA-256 |
| --- | --- | --- | --- |
| `6930-75918-0000.flac` | test-clean | CONCORD RETURNED TO ITS PLACE AMIDST THE TENTS | `9ce35224156f071ab58eb7feb8a5ceae600f6f9f353da2a6cbf797b6b1ac8a23` |
| `1320-122617-0000.flac` | test-clean | NOTWITHSTANDING THE HIGH RESOLUTION OF HAWKEYE HE FULLY COMPREHENDED ALL THE DIFFICULTIES AND DANGER HE WAS ABOUT TO INCUR | `8948a7773a0bf478d4aab72401532da7e5496eafd3c89d432ede3b599be6e0a9` |
| `7902-96591-0000.flac` | test-other | I AM FROM THE CUTTER LYING OFF THE COAST | `955d0cc57211f03986124307ade29fbab521e26133caa2d2831b9a1b38c7a9b6` |
| `5764-299665-0095.flac` | test-other | THIS FREES WOMAN | `84fcade4a87b09be6bdbf95af8ccffaf73f6101c982fd47ca56ab878d13d2cdf` |

Music-like tones, broadband noise, and LFE interference are generated deterministically by the
repository script and carry no external recording rights. Dialogue intervals describe the complete
source utterance placement, including natural intra-utterance pauses. This is intentional: the
corpus measures programme-dialogue selection rather than phoneme-level speech segmentation.

This compact corpus is a regression and product-decision aid, not a claim of universal VAD
accuracy. Non-redistributable programme material can be evaluated through a separate local manifest
without being copied into the repository.
