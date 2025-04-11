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

// turns 1 into '1st', etc.
function ordinal(number) {
  var suffixes = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'];
  if (((number % 100) == 11) || ((number % 100) == 12) || ((number % 100) == 13))
    return number + suffixes[0];
  return number + suffixes[number % 10];
}

// Load the GeoJSON files.
var census_boundaries = process.argv.slice(2)
  .map(fn => {
    return JSON.parse(fs.readFileSync(fn, 'utf8'))
      .features;
  }).flat();

// Re-style GeoJSON features.
census_boundaries = census_boundaries
  .filter(function(d) {
    // Some states have district 'ZZ' which represents the area of
    // a state, usually over water, that is not included in any
    // congressional district --- filter these out.
    if (d.properties['CD119FP'] == 'ZZ')
      return false;
    return true;
  })
  .map(function(item) {
    // Get state from FIPS code.
    let stateinfo = stateFipsCodesMap[parseInt(item.properties.STATEFP)];
    stateinfo.seen = true; // did we get boundaries for every state?

    // Get the district number in two-digit form: "00" for at-large
    // districts, "01", "02", .... The Census data's CD___FP field
    // holds it in this format, except for the island territories
    // which have "98", but are just at-large and should be "00".
    let district_number = item.properties.CD119FP;
    if (district_number == "98") district_number = "00";
    if (district_number == "AL") district_number = "00"; // American Redistricting Project

    return {
      "type": "Feature",
      "properties": {
        state: stateinfo.USPS,
        state_name: stateinfo.Name,
        number: district_number,
        title_short: stateinfo.USPS + ' ' + (district_number == "00" ? "At Large" : parseInt(district_number)),
        title_long: stateinfo.Name + '’s ' + (district_number == "00" ? "At Large" : ordinal(parseInt(district_number))) + ' Congressional District',
      },
      "geometry": item.geometry
    };
  });

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

// Create a new empty FeatureCollection to contain final map data that
// contains both district boundaries and label points.
var mapData = { 'type': 'FeatureCollection', 'features': [] }
districts.features.forEach(function(d) {
  // Add a type property to distinguish between labels and boundaries
  d.properties.group = 'boundary';
  mapData.features.push(d);

  // Compute a good location to place a label for this district.
  // If the district has multiple parts, like some islands, put
  // a label in each part otherwise there's no way to know what
  // district the part is. Also polylabel doesn't work with a
  // MultiPolygon.

  function addLabel(feature)
  {
    var label_coord = polylabel(feature.geometry.coordinates, 0.000001);
    if (Number.isNaN(label_coord[0]))
      throw d.properties.title_long;

    // Create a turf.point to hold information for rending labels.
    var pt = turf.point(label_coord);

    // copy district metadata to the label
    pt.properties = JSON.parse(JSON.stringify(feature.properties)); // copy hack to avoid mutability issues

    pt.properties.group = 'label';

    // add the area to the point to control zoom level steps for label styling
    pt.properties.area = turf.area(feature);

    // add both the label point and congressional district to the mapData feature collection
    mapData.features.push(pt);
  }

  if (d.geometry.type == "MultiPolygon")
  {
    // Split the MultiPolygon into Polygon features.
    d.geometry.coordinates.forEach(geom => {
      let polygon = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: geom
        },
        properties: d.properties
      };
      addLabel(polygon);
    });
  }
  else if (d.geometry.type == "Polygon")
  {
    addLabel(d);
  }
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

