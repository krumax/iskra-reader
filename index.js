'use strict';
var serialport = require('serialport');
var parsers = serialport.parsers;
const fs = require('fs');
const request = require('request');
const config =  require('./config.json');

var port = new serialport('/dev/ttyUSB0', {
	baudRate: 300,
	dataBits: 7,
	stopBits: 1,
	parity: 'even',
	parser: parsers.readline('\r\n')
});

port.on('open', function() {
	console.log('Port open');
	init();
});

port.on('data', function(line) {
	if (line.lastIndexOf('1-0:1.8.0*255') >= 0) {
		var timestamp = new Date().getTime();
		var energy = line.match(/\(([^)]+)\*kWh\)/)[1];
		console.log(timestamp, energy);
		fs.appendFile('data.csv', timestamp+';'+energy+'\n', function (err) {
		  	if (err) return console.log(err);
		});

		var data = config.influxdb.measurement + ',obis=1.8.0*255 workIn=' + energy + ' ' + timestamp*1000000;

		sendToInflux(data, true);
	}
});

function init() {
	getData();
	setInterval(getData, 5*60*1000);
	setInterval(resend, 30*60*1000);
}

function getData() {
	port.write('/?!\r\n');
}

function sendToInflux(data, doBuffer, callback) {
	request.post({
		headers: {'content-type' : 'text/plain'},
		url:     config.influxdb.writeUrl,
		body:    data }, 
		function(error,response,body) {
		if (error || response.statusCode >= 400) {
			console.warn('Error writing data to influxdb!');
			if (doBuffer) {
				console.warn('Buffering data...');
				fs.appendFile(config.bufferFileName, data + '\n', function(err) {
					if (err) return console.log(err);
				});	
			}
			if (callback) callback("Error");
		} else {
			console.log('Data written to influxdb');
			if (callback) callback();
		}

	})
}

function resend() {
	console.log('Resending failed data from buffer.');
	fs.readFile(config.bufferFileName, 'utf8', function(err, data) {
	    if (err) {
	        console.log('Error reading bufferfile', config.bufferFileName);
	    } else {
	    	var bufferFileLines = data.split('\n');
	    	var newBuffer = [];
	    	if (bufferFileLines.length - 1) {
	    		console.log('Retrying', bufferFileLines.length - 1, 'data entries.');
	    	} else {
	    		console.log('Nothing to send.');
	    		return;
	    	}
	    	for (var i = bufferFileLines.length - 1; i >= 0; i--) {
	    		var bufferLine = bufferFileLines[i];
	    		sendToInflux(bufferLine, false, function(err) {
	    			if (err) {
	    				console.log('resend failed');
	    				newBuffer.push(bufferLine);
	    			}
	    		}); 
	    	}
	    	fs.writeFile(config.bufferFileName, newBuffer.join('\n'));	
	    }
	});
};
