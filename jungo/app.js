"use strict";

const express = require('express');

const bodyParser = require('body-parser');

const config = require('./config.json');

const responseTime = require('response-time');

const PORT = config.port || 8000;

const app = express();

const index = require('./routes/index');

app.disable('x-powered-by');

app.set('port', PORT);

app.use(responseTime());

app.use(bodyParser.json());

app.use('/', index);

//404 handler
app.use(function (req, res, next) {
    res.status(404);
    res.send('Not found');
});

let server = app.listen(PORT, function () {
    console.log(`Jungo listening on port ${PORT}!`);
});

server.timeout = 0;