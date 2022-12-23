# Mapping US Congressional Districts

These instructions create maps for the 118th Congress using district boundaries as of the 2022 elections.)

NOTE: Typically we use Census Bureau data but to get ahead of the game for the 118th Congress, since Census data is not yet published for the new districts, these instructions use congressional district geospatial data collected by the [American Redistricting Project](https://thearp.org/blog/map-archive/) as combined into a single file by [Glenn Rice](https://acsdatacommunity.prb.org/discussion-forum/f/forum/977/shapefiles-for-118th-cds-current-slds) on June 8, 2022. ARP doesn't include boundaries for DC and the island territories, so they are added from the Census's most recent congressional district shapefiles.

---

Follow the steps below to create a web map of United States congressional districts from [Census Bureau geospatial data](https://www.census.gov/programs-surveys/geography/technical-documentation/user-note/cd-sld-note.html) using Mapbox to render the web map. You can also use this to create a lat/lng-to-congressional district API using the Mapbox API.

You will need an account on Mapbox.com. Then follow the commands below from the Mac OS X or Ubuntu terminal.

Why use [Tippecanoe](https://github.com/mapbox/tippecanoe)? Using Tippecanoe provides more control over how the geometries are tiled into a map. For comparison, using the Mapbox Studio default upload will not show a zoomed-out full country view of the data because the boundaries are so detailed; the default upload thinks you are only interested in looking closer at the data. Tippecanoe stops  oversimplification of the geometry and also specifies a min/max zoom level.

#### Dependencies:

On OS X, install required dependencies with Homebrew:

```
brew install tippecanoe gdal node
```

On Ubuntu, you'll need node:

```
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | bash
nvm install 5.0
```

and gdal and Tippecanoe, which must be built from sources:

```
sudo apt-get install gdal-bin libprotobuf-dev protobuf-compiler libsqlite3-dev
git clone https://github.com/mapbox/tippecanoe
cd tippecanoe
make
cd ..
```

#### Setup:

Download this repository and then use `npm` to install a few more dependencies:

```
git clone https://github.com/govtrack/congress-maps.git
cd congress-maps
npm install
```

#### Creating the map:

To complete these steps, run the commands below.

```sh
# create directory to store data
mkdir data

# dowload district boundary data, unzip the data, and convert it to GeoJSON
wget -P data ftp://ftp2.census.gov/geo/tiger/TIGER2022/CD/tl_2022_us_cd116.zip
unzip data/tl_2022_us_cd116.zip -d ./data/
ogr2ogr -f GeoJSON -t_srs crs:84 data/congressional_districts_116.geojson data/tl_2022_us_cd116.shp

wget -P data https://mcdc.missouri.edu/data/georef/leg_districts_2022/USA_CD118.zip
unzip data/USA_CD118.zip -d ./data/
ogr2ogr -f GeoJSON -t_srs crs:84 data/congressional_districts.geojson data/USA_CD118.shp

# normalize format and add label points, saving to data/map.geojson and data/bboxes.js
node process.js

# create Mapbox vector tiles from data
tippecanoe/tippecanoe \
	-f -Z 0 -z 12 -B0 -pS \
	-o data/cd-118-2022-arp.mbtiles \
	--name "118th Congress (2022 Election) Congressional Districts - American Redistricting Project Data" \
	data/map.geojson
```

For the last step to upload the map boundaries to Mapbox, set `MAPBOX_USERNAME` to your Mapbox username, `MAPBOX_DEFAULT_ACCESS_TOKEN` to your Mapbox default public token, and `MAPBOX_ACESS_TOKEN` to a `uploads:write` scope access token from your [Mapbox account](https://www.mapbox.com/studio/account/tokens).

```sh
# setup Mapbox account name, default public token, and write-scoped token
export MAPBOX_USERNAME=<your mapbox username>
export MAPBOX_DEFAULT_ACCESS_TOKEN=<your mapbox default access token>
export MAPBOX_WRITE_SCOPE_ACCESS_TOKEN=<your mapbox write scope access token>

# upload map data to Mapbox.com
node upload.js data/cd-118-2022-arp.mbtiles "cd-118-2022-arp" "US_Congressional_Districts_118th_Congress_2022_Election_ARP"
```

Check out [mapbox.com/studio](https://www.mapbox.com/studio) to see updates on data processing. Once Mapbox is finished processing your upload, you can make a map style. Click New Style. Choose a template --- I last tried Navigation - Day, which seemed nice. Then create layers:

* Create a new layer and select the uploaded tileset as the source. Change the type to fill. In Style - Color, click Style With Data Conditions. Select color_index as the data value. Select 0, choose a color, click Done. Then click Add Another Condition and repeat for 1 through 4. Click Opacity, Style Across Zoom Range. Click the stop point for zoom 22 and set the opacity to 0 and the zoom level to 15, so that the fills fade out when zoomed into street level. Name the layer CD-Fills. Drag the layer all the way to the bottom of the layers but above "Land & water, land" so that it covers the base color for land but is behind all of the other map features. 
* Create another layer with the same data named CD-Outlines. Set its type to Line. In Style, click Width, then Style Across Zoom Range. Set the first zoom stop to zoom level 3 and line width 1px. Set the second zoom stop to zoom level 15 and the line width to 4px. Keep this layer at the top.
* Create another layer named CD-Labels. Set its type to Symbol. Set a filter on `group` to `label`. In Style, click Text Field, style across zoom range. At zoom stop 0, set the text field to the data field title_short. Set the second stop to zoom level 7 and the text field to the data field title_long. I set the font to Montserrat Light 12px at zoom level 0 and Montserrat Bold 16px at zoom level 7. I added 4 px white halo.
* In the Administrative Boundaries component, I turned off all boundaries.
* Click Publish.

#### Usage:

Use the files in the `example` directory as the basis for making a web map with functionality to focus on specific states or districts. To use this example web map, you'll need to edit `index.html` and insert your default public access token and the style URL and tileset ID from Mapbox.

After following the steps above, `index.html` will be a full page web map of U.S. Congressional districts. Host this file and the two supporting scripts (`states.js`, `bboxes.js`) on your website. If you don't want the interactive menu on your map, search through `index.html` and remove all sections of code that immediately follow the `INTERACTIVE MENU` line comment labels.

With this web map, you can show specific congressional districts using the URL hash. Set the location hash to `state={state abbreviation}` to show a specific state and add `&district={district number}` to specify a district within the state. The hash expects US Census two letter state abbreviations and district number conventions. At Large districts are numbered `00` and all other districts are two character numbers: `district=01`, `district=02`, ..., `district=15`, etc.

See the click handler for an example of how to use the Mapbox API to get the congressional district at a particular lat/lng coordinate.

#### Examples:

To show districts in the state of Virginia: http://www.aarondennis.org/congress-maps/example/#state=VA

To show the 5th district of California: http://www.aarondennis.org/congress-maps/example/#state=CA&district=05
