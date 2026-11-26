# img-precheck

A zero-dependency Node.js command-line tool that checks photos for format, file size, resolution and aspect ratio before you upload them.

## Why

AI outfit try-on tools work from the pixels you give them. A photo that is too small carries too little detail of the body and fabric, and a very long, narrow image has to be squeezed or padded before it can be used. Upload forms reject these files, often after the upload finishes. img-precheck runs the same checks locally first, on one file or a whole folder.

It reads image headers itself (PNG `IHDR`, JPEG `SOF0/1/2`, WebP `VP8`/`VP8L`/`VP8X`, HEIC `ispe`), installs nothing and makes no network requests.

## Usage

Requires Node.js 14 or newer.

```
git clone https://github.com/kosohool/img-precheck.git
cd img-precheck
node scripts/make-samples.js        # writes synthetic test images to ./samples
node check.js --role person samples
```

Real output from the command above:

```
role: person (shortest side >= 640px, <= 10 MB, ratio <= 3)
samples/clothes/shirt-flat.png | PNG | 500x700 | 1.1 KB | format pass | size pass | short FAIL | ratio pass (1.40) | FAIL
samples/full-body.webp | WebP | 720x1280 | 34 B | format pass | size pass | short pass | ratio pass (1.78) | PASS
samples/phone-photo.heic | HEIC | ?x? | 24 B | format pass | size pass | short FAIL | ratio FAIL | FAIL - 无法读取尺寸，请先转成 JPG 或 PNG
samples/portrait.jpg | JPEG | 1200x1600 | 7.5 KB | format pass | size pass | short pass | ratio pass (1.33) | PASS
samples/small-selfie.png | PNG | 480x640 | 1013 B | format pass | size pass | short FAIL | ratio pass (1.33) | FAIL
samples/wide-banner.webp | WebP | 2400x600 | 52 B | format pass | size pass | short FAIL | ratio FAIL (4.00) | FAIL
已跳过 (1):
  samples/notes.txt
2/6 passed
```

Use `--role clothes` for garment photos. Folders are searched recursively; other extensions are listed as skipped (已跳过). A HEIC file whose dimensions cannot be read fails with a note asking you to convert it to JPG or PNG. The exit code is `0` when every file passes and `1` otherwise, so it works in scripts and CI. See `node check.js --help`; run tests with `node test.js`.

## Thresholds

| Check | person (default) | clothes |
|---|---|---|
| Format | JPG, PNG, WebP, HEIC | JPG, PNG, WebP, HEIC |
| File size | at most 10 MB | at most 10 MB |
| Shortest side | at least 640 px | at least 400 px |
| Long side ÷ short side | at most 3 | at most 3 |

Every threshold is a named constant at the top of `check.js`, so you can adjust them for a different service.

## Where the rules come from

The thresholds follow the upload rules of Vestila, an AI outfit try-on service. If you want to see how they are applied in practice, read the [Vestila virtual try-on guide](https://vestila.app/virtual-try-on).

## License

MIT. See [LICENSE](LICENSE).
