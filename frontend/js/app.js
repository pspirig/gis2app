let map;
let appState = {
    markers: null,
    latLng: null,
    radius: null,
    heading: null,
    name: null
};

let wfs = 'https://baug-ikg-gis-01.ethz.ch:8443/geoserver/GTA26_lab07/wfs';

/**
 * Draws the markers on the map.
 */
function drawMarkers() {
    if (map && appState.markers && appState.latLng && appState.radius) {
        appState.markers.clearLayers();
        let circle = L.circle(appState.latLng, {
            radius: appState.radius
        });
        appState.markers.addLayer(circle);

        if (appState.heading !== null) {
            let radius = circle.getBounds().getCenter().lat - circle.getBounds().getSouth();
            let startPointLat = appState.latLng.lat - radius * Math.cos(appState.heading);
            let startPointLng = appState.latLng.lng - radius * Math.sin(appState.heading);
            let endPointLat = appState.latLng.lat - radius * 3 * Math.cos(appState.heading);
            let endPointLng = appState.latLng.lng - radius * 3 * Math.sin(appState.heading);

            LatLngsHeading = [
                [startPointLat, startPointLng],
                [endPointLat, endPointLng]
            ];
            appState.markers.addLayer(L.polyline(LatLngsHeading, {color: 'rgb(255, 0, 0)'}));
        }
    }
}

/**
 * Function to be called whenever a new position is available.
 * @param position The new position.
 */
function geoSuccess(position) {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;
    appState.latLng = L.latLng(lat, lng);
    appState.radius = position.coords.accuracy / 2;
    drawMarkers();

    if (map) {
        map.setView(appState.latLng);
    }
}

/**
 * Function to be called if there is an error raised by the Geolocation API.
 * @param error Describing the error in more detail.
 */
function geoError(error) {
    let errMsg = $("#error-messages");
    errMsg.text(errMsg.text() + "Fehler beim Abfragen der Position (" + error.code + "): " + error.message + " ");
    errMsg.show();
}

let geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 15000,  // The maximum age of a cached location (15 seconds).
    timeout: 12000   // A maximum of 12 seconds before timeout.
};

/**
 * The onload function is called when the HTML has finished loading.
 */
function onload() {
    let errMsg = $("#error-messages");

    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(geoSuccess, geoError, geoOptions);
    } else {
        errMsg.text(errMsg.text() + "Geolocation is leider auf diesem Gerät nicht verfügbar. ");
        errMsg.show();
    }

    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', function (eventData) {
            appState.heading = eventData.alpha * (Math.PI / 180);
            drawMarkers();
        }, false);
    } else {
        errMsg.text(errMsg.text() + "DeviceOrientation ist leider nicht verfügbar. ");
        errMsg.show();
    }
	
	// Adding map layer
    map = L.map('map').setView([47.376750, 8.540721], 16);
    appState.markers = L.layerGroup();
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.addLayer(appState.markers);
	
	
	// ------- WFS -------
	
	// button to upload data (add POI)
	$( "#uploadBtn" ).click(function() {
		formSubmit();
	});
	
	// For dialog form
	$("#fillInFormDiv").dialog({
		modal: true,
		autoOpen: false,
		height: 400,
		width: 350,
		close: function() {
			$("#fillInForm").trigger("reset");
			$(this).dialog("close");
		}
	});

	$("#fillInBtn").on("click", function() {
		$("#fillInForm").trigger("reset");
		$("#fillInFormDiv").dialog("open");
		$("#fillInFormDiv").parent().css('z-index', 500);
	}); 
}

// Shows a form for the user to enter POI name
function formSubmit() {
	console.log("submitted POI Name: "+$("#poiName").val());
    appState.name = $("#poiName").val();
    //insertPoint(47.3, 8.5, "point2"); // hard coding example, comment this line and instead use the code on the next line
	insertPoint(appState.latLng.lat, appState.latLng.lng, appState.name);
	$("#fillInForm").trigger("reset");
	$("#fillInFormDiv").dialog("close");
}

// Inserts the point in the database
function insertPoint(lat, lng, name) {
	// TODO: Declare a variable called postData and assign an appropriate value.
    

    let postData =
        '<wfs:Transaction\n'
    +   '   service="WFS"\n'
    +   '   version="1.0.0"\n'
    +   '   xmlns:wfs="http://www.opengis.net/wfs"\n'
    +   '   xmlns:gml="http://www.opengis.net/gml"\n'
    +   '   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n'
    +   '   xmlns:GTA26_lab07="https://www.gis.ethz.ch/GTA26_lab07">\n'
    +   '   <wfs:Insert>\n'
    +   '       <GTA26_lab07:gta_u22_lab07>\n'
    +   '           <lon>'+lng+'</lon>\n'
    +   '           <lat>'+lat+'</lat>\n'
    +   '           <name>'+name+'</name>\n'
    +   '           <geometry>\n'
    +   '               <gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326">\n'
    +   '                   <gml:coordinates decimal="." cs="," ts=" ">'+ lng + ',' + lat +'</gml:coordinates>\n'
    +   '               </gml:Point>\n'
    +   '           </geometry>\n'
    +   '       </GTA26_lab07:gta_u22_lab07>\n'
    +   '   </wfs:Insert>\n'
    +   '</wfs:Transaction>'
    
	$.ajax({
		type: "POST",
		url: wfs,
		dataType: "xml",
		contentType: "text/xml",
		data: postData,
		success: function(response) {
			console.log("AJAX request succeeded");

			// Check for WFS exception
			let exception = $(response).find("ServiceException");

			if (exception.length > 0) {
				let msg = exception.text();

				console.error("WFS Transaction failed:");
				console.error(msg);

				alert("WFS Error:\n" + msg);
				return;
			}

			// Check if transaction succeeded
			let successNode = response.getElementsByTagName("wfs:SUCCESS");

			if (successNode.length > 0) {
				console.log("WFS Transaction successful");
				alert("Data successfully inserted into database.");
			} else {
				console.log("Transaction response received, but success could not be verified.");
				alert("Response received from Geoserver. Please check the response details.");
			}

			console.log(new XMLSerializer().serializeToString(response));
		},
		error: function (xhr, errorThrown) {
			console.error("AJAX Error");
			console.error("HTTP Status:", xhr.status);
			console.error(errorThrown);

			alert("Connection to Geoserver failed.\n" + "HTTP Status: " + xhr.status);
		}
	});
}