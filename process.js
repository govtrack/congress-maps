var fs = require('fs'),
    fiveColorMap = require('five-color-map'),
    turf = require('@turf/turf'),
    polylabel = require('@mapbox/polylabel');

// Load the state names, FIPS codes, and USPS abbreviations and make a mapping
// from FIPS codes (found in Census data) to USPS abbreviations (used in our output).
var stateCodes = JSON.parse(fs.readFileSync('states.json', 'utf8'));
var stateFipsCodesMap = { };
stateCodes.forEach(function(item) { stateFipsCodesMap[item.FIPS] = item; })
fs.writeFileSync('./example/states.js', 'var states = ' + JSON.stringify(stateCodes, null, 2));

// Load and re-format the congressional district data.
var census_boundaries = 
  JSON.parse(fs.readFileSync("data/congressional_districts.geojson", 'utf8'))
  .features
  .filter(function(d) {
    // Some states have district 'ZZ' which represents the area of
    // a state, usually over water, that is not included in any
    // congressional district --- filter these out
    if (d.properties['CD116FP'] == 'ZZ')
      return false;

    // Remove NC's districts which were revised and are loaded
    // from a separate file.
    if (d.properties['STATEFP'] == 37)
      return false;

    return true;
  })
  // re-do the Feature's properties to our own format
  .map(function(item) {
    return {
      "type": "Feature",
      "properties": {
        // Convert from FIPS code.
        state: stateFipsCodesMap[parseInt(item.properties.STATEFP)].USPS,
        state_name: stateFipsCodesMap[parseInt(item.properties.STATEFP)].Name,

        // Get the district number in two-digit form ("00" (for at-large
        // districts), "01", "02", ...). The Census data's CD116FP field
        // holds it in this format. Except for the island territories
        // which have "98", but are just at-large and should be "00".
        number: item.properties.CD116FP == "98" ? "00" : item.properties.CD116FP,

        // Census TIGER files have INTPTLON/INTPTLAT which conveniently
        // provides a point where a label for the polygon can be placed.
        // But these points have inconsistent quality in terms of usage
        // for labels, and some are very poorly located, so we don't use them
        // unless the alternate method of locating a label point fails.
        label_pt_lon: parseFloat(item.properties.INTPTLON),
        label_pt_lat: parseFloat(item.properties.INTPTLAT),
      },
      "geometry": item.geometry
    };
  });

// Add NC's districts.
census_boundaries = 
  census_boundaries.concat(
  JSON.parse(fs.readFileSync("data/congressional_districts_nc.geojson", 'utf8'))
  .features
  .map(function(item) {
    return {
      "type": "Feature",
      "properties": {
        state: "NC",
        state_name: stateFipsCodesMap[37].Name,

        // Get the district number in two-digit form ("00" (for at-large
        // districts), "01", "02", ...).
        number: (item.properties.DISTRICT.length == 1 ? '0' : '')
          + item.properties.DISTRICT,
      },
      "geometry": item.geometry
    };
  }));

// Build a new FeatureCollection that we can pass into fiveColorMap.
var districts = {
  'type': 'FeatureCollection',
  'features': census_boundaries
};

// Use the five-color-map package to assign color numbers to each
// congressional district so that no two touching districts are
// assigned the same color number. fiveColorMap assigns a 'fill'
// property to each feature with a differnet color, but the colors
// aren't what we want. Change these back to indexes.
districts = fiveColorMap(districts);
var fiveColorMapMap = { };
districts.features.forEach(function(feature) {
  if (typeof fiveColorMapMap[feature.properties.fill] == "undefined")
    fiveColorMapMap[feature.properties.fill] = Object.keys(fiveColorMapMap).length;
  feature.properties.color_index = fiveColorMapMap[feature.properties.fill];
  delete feature.properties.fill;
});

// turns 1 into '1st', etc.
function ordinal(number) {
  var suffixes = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'];
  if (((number % 100) == 11) || ((number % 100) == 12) || ((number % 100) == 13))
    return number + suffixes[0];
  return number + suffixes[number % 10];
}

// Create a new empty FeatureCollection to contain final map data that
// contains both district boundaries and label points.
var mapData = { 'type': 'FeatureCollection', 'features': [] }
districts.features.forEach(function(d) {
  // Compute a good location to place a label for this district. Use the
  // polygon with the largest area.
  var label_coord = polylabel(d.geometry.coordinates, .01);
  if (Number.isNaN(label_coord[0])) {
    // polylabel fails for a variety of districts for unknown reasons.
    // Fall back to the Census interior points.
    label_coord = [d.properties.label_pt_lon, d.properties.label_pt_lat];
    //console.log(d.properties.state, d.properties.number, label_coord);
  }

  // Create a turf.point to hold information for rending labels.
  var pt = turf.point(label_coord);

  // add metadata to the label
  pt.properties = JSON.parse(JSON.stringify(d.properties)); // copy hack to avoid mutability issues
  pt.properties.title_short = d.properties.state + ' ' + (d.properties.number == "00" ? "At Large" : parseInt(d.properties.number));
  pt.properties.title_long = d.properties.state_name + '’s ' + (d.properties.number == "00" ? "At Large" : ordinal(parseInt(d.properties.number))) + ' Congressional District';
  delete pt.properties.label_pt_lon;
  delete pt.properties.label_pt_lat;

  // add a type property to distinguish between labels and boundaries
  pt.properties.group = 'label';
  d.properties.group = 'boundary';

  // add both the label point and congressional district to the mapData feature collection
  mapData.features.push(pt);
  mapData.features.push(d);
});

// Write out the mapData. It's too large to use JSON.stringify with indentation,
// so output in a kind of streaming way.
var f = fs.openSync('./data/map.geojson', 'w');
fs.writeSync(f, '{\n"type": "FeatureCollection",\n"features": [\n');
var first = true;
mapData.features.forEach(function(item) {
  if (!first) fs.writeSync(f, ",\n"); first = false;
  fs.writeSync(f, JSON.stringify(item, null, 2));
});
fs.writeSync(f, "\n]\n}");
fs.closeSync(f);

// Compute bounding boxes for each congressional district and each
// state so that we know how to center and zoom maps.

var districtBboxes = {},
    stateBboxes = {};

districts.features.forEach(function(d) {
  var bounds = turf.bbox(d);

  // for the district
  districtBboxes[d.properties.state + d.properties.number] = bounds;

  // and for the states
  if (stateBboxes[d.properties.state]) {
    stateBboxes[d.properties.state].features.push(turf.bboxPolygon(bounds));
  } else {
    stateBboxes[d.properties.state] = { type: 'FeatureCollection', features: [] };
    stateBboxes[d.properties.state].features.push(turf.bboxPolygon(bounds));
  }
})

for (var s in stateBboxes) {
  stateBboxes[s] = turf.bbox(stateBboxes[s]);
}

var bboxes = {};
for (var b in districtBboxes) { bboxes[b] = districtBboxes[b] };
for (var b in stateBboxes) { bboxes[b] = stateBboxes[b] };
fs.writeFileSync('./data/bboxes.js', 'var bboxes = ' + JSON.stringify(bboxes, null, 2));

