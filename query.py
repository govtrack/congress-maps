import sys

import math
import gzip
import urllib.request
from pmtiles.reader import Reader, MmapSource
from pmtiles.tile import Compression
import mapbox_vector_tile
import shapely

if len(sys.argv) <= 1:
    print("Usage: query.py PMTILES_FILE ZOOM LONG LAT")
    exit(1)

class PmtilesWebSource:
    def __init__(self, url):
        self.url = url
    def __call__(self, offset, length):
        # Server must support HTTP range.
        req = urllib.request.Request(self.url, headers={'Range':f'bytes={offset}-{offset+length-1}'})
        resp = urllib.request.urlopen(req)
        return resp.read()

class PmtilesLookup:
    def __init__(self, filename, zoomlevel):
        if not filename.lower().startswith("https://"):
            with open(filename, "r+b") as f:
                source = MmapSource(f)
        else:
            source = PmtilesWebSource(filename)
        self.reader = Reader(source)
        self.header = self.reader.header()
        self.zoomlevel = zoomlevel

    @staticmethod
    def lnglat_to_tile(zoom, lon, lat):
        # Based on https://stackoverflow.com/a/76995785, but rather than
        # rounding down, modf is used to return the rounded-down part
        # and the remainder. The remainder is used to query the polygons
        # that occur within the tile.
        import math
        x = math.modf((lon+180)/360*math.pow(2,zoom))
        y = math.modf((1-math.log(math.tan(lat*math.pi/180) + 1/math.cos(lat*math.pi/180))/math.pi)/2 *math.pow(2,zoom))
        return ((int(x[1]), x[0]), (int(y[1]), y[0]))

    def get_tile(self, lng, lat):
        (x, tilex), (y, tiley) = self.lnglat_to_tile(self.zoomlevel, lng, lat)
        tile = self.reader.get(self.zoomlevel, x, y)
        if self.header["tile_compression"] == Compression.GZIP:
            tile = gzip.decompress(tile)
        features = mapbox_vector_tile.decode(tile, default_options={ "y_coord_down": True })
        return (features, tilex, tiley)

    def intersect_features(self, features, tilex, tiley):
        if not 'layer' in features: return
        layer = features['layer']
        extent = layer['extent']
        if not 'features' in layer: return
        for feature in layer['features']:
            geometry = feature['geometry']
            #print(geometry['type'], feature['properties']['title_short'])
            if geometry['type'] == 'Polygon':
                geometry = [geometry['coordinates']]
            elif geometry['type'] == 'MultiPolygon':
                geometry = geometry['coordinates']
            else:
                continue
            geometry = [
                [ [(ptx / extent, pty / extent) for (ptx, pty) in ring]
                 for ring in poly ]
                for poly in geometry ]
            for poly in geometry:
                if shapely.Polygon(poly[0], poly[1:]).contains(shapely.Point((tilex, tiley))):
                    #print("", "matched")
                    yield feature
                    break # no need to match other polygons within this MultiPolygon

    def __call__(self, lng, lat):
        (features, tilex, tiley) = self.get_tile(lng, lat)
        for feature in self.intersect_features(features, tilex, tiley):
            return (feature['properties']['state'], int(feature['properties']['number']))

fname = sys.argv[1]
zoom = int(sys.argv[2])
lng = float(sys.argv[3])
lat = float(sys.argv[4])

pmtiles = PmtilesLookup(fname, zoom)
print(pmtiles(lng, lat)) # (state, district)
