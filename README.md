# Mapping US Congressional Districts

These instructions create maps for the 119th Congress using district boundaries as of the 2024 elections. An example UI using maplibre-gl is in the `example` directory, and a Python lat/lng-to-district function is included.

Follow the steps below to create a web map of United States congressional districts from [Census Bureau geospatial data](https://www.census.gov/programs-surveys/geography/technical-documentation/user-note/cd-sld-note.html). This year we are using Census Bureau data, but some years we use [American Redistricting Project](https://thearp.org/blog/map-archive/) shapefiles when Census data is out of date.

[Tippecanoe](https://github.com/felt/tippecanoe) (2.17+) compiles the geospatial boundaries into a pmtiles file for efficiently serving vector tiles at various zoom levels.

## Dependencies

On Ubuntu, you'll need node, GDAL, Tippecanoe, and this project's dependencies:

```
git clone https://github.com/govtrack/congress-maps.git
cd congress-maps

# node
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | bash
nvm install stable

# GLAD
sudo apt install gdal-bin

# Tippecanoe
sudo apt install libprotobuf-dev protobuf-compiler libsqlite3-dev
git clone https://github.com/felt/tippecanoe # or download a release ZIP
cd tippecanoe
make -j
cd ..

# this repository's dependencies
npm install
```

## Generating the GeoJSON and PMTiles files

To complete these steps, run the commands below.

```sh
# create directory to store data
mkdir data

# dowload district boundary data, unzip the data, and convert it to GeoJSON
wget -P data ftp://ftp2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_*_cd119.zip
for fn in data/*_cd119.zip; do
	unzip -oq $fn -d ./data/
	ogr2ogr -f GeoJSON -t_srs crs:84 $(echo $fn | sed s/zip/geojson/) $(echo $fn | sed s/zip/shp/)
done

# normalize format and add label points, saving to data/map.geojson and data/bboxes.js
node process.js data/tl_2024*.geojson

# create vector tile cache from data
tippecanoe/tippecanoe \
	-f -Z 0 -z 12 -B0 -pS \
	-l layer -o data/cd-119-2024.pmtiles \
	--name "119th Congress (2024 Election) Congressional Districts" \
	data/map.geojson
```

## Extracting a United States baselayer

Download go-pmtiles https://github.com/protomaps/go-pmtiles/releases and select a Protomaps baselayer from https://maps.protomaps.com/builds/:

```
go-pmtiles_*/pmtiles extract https://build.protomaps.com/20250407.pmtiles example/baselayer.pmtiles --maxzoom=12 --region=united_states_region.geojson
```

That's enough to run the example.

## Testing

Start a debug server:

```sh
node_modules/http-server/bin/http-server . --cors
```

and visit http://127.0.0.1:8080/example.

