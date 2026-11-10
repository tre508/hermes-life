import statistics
try:
    from PIL import Image
except Exception:
    raise SystemExit("NO_PIL")
im = Image.open("phase6-reports/vis007-live-frame.png").convert("RGB")
w, h = im.size
data = list(im.getdata())
total = w * h
lum = [int(0.299*r + 0.587*g + 0.114*b) for r, g, b in data]
nonblack = sum(1 for v in lum if v > 10)
mid = sum(1 for v in lum if 30 < v < 200)
bright = sum(1 for v in lum if v >= 200)
amber = sum(1 for r, g, b in data if r > 120 and 60 < g < 160 and b < 140)
steel = sum(1 for r, g, b in data if b > r and b > 80)
print("size=%dx%d total=%d" % (w, h, total))
print("nonblack_px=%d (%.1f%%)" % (nonblack, 100*nonblack/total))
print("midtone_px=%d (%.1f%%)  bright_px=%d (%.1f%%)" % (mid, 100*mid/total, bright, 100*bright/total))
print("amber_warm_px=%d (%.1f%%)  steel_blue_px=%d (%.1f%%)" % (amber, 100*amber/total, steel, 100*steel/total))
rd = list(im.crop((0, h//3, w, 2*h//3)).convert("L").getdata())
print("mid-third mean_lum=%.1f, stdev=%.1f" % (statistics.mean(rd), statistics.pstdev(rd)))
gray = im.crop((0, h//3, w, 2*h//3)).convert("L")
c = gray.load()
cov = 0
thr = 10*len(range(h//3))
yy = len(range(h//3))
for x in range(w):
    s = sum(c[x, y] for y in range(h//3))
    if s > thr:
        cov += 1
print("horizontal coverage of scene in mid band: %.1f%%" % (100*cov/w))
# edge-band darkness vs center (framing: is the facility centered?)
band = im.convert("L")
bl = band.load()
edge = sum(bl[x,y] for x in range(w//6) for y in range(h//6))
edge_c = (w//6)*(h//6)
mean_edge = edge/edge_c
print("mean luminance top-left corner band: %.1f" % mean_edge)
