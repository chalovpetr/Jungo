"use strict";

const express = require('express');

const busboy = require('connect-busboy');

const request = require('request');

const fs = require('fs');

const path = require('path');

const Router = express.Router();

const crypto = require('crypto');

const config = require('../config.json');

const rejectDelay = require('../helpers/rejectDelay');

const DOWNLOAD_TIMEOUT = config.download_timeout * 1000;

const BULB_RESPONSE_TIMEOUT = config.bulb_response_timeout * 1000;

const BULB_URL = config.bulb_url;

const DOWNLOAD_TIMEOUT_ERROR = 'DOWNLOAD_TIMEOUT_ERROR';

const BULB_RESPONSE_TIMEOUT_ERROR = 'BULB_RESPONSE_TIMEOUT_ERROR';

const REMOTE_NOT_FOUND_ERROR = 'REMOTE_NOT_FOUND_ERROR';

Router.post('/', busboy(), handleRoute);

module.exports = Router;

function getRemoteStream(file_url) {

    return new Promise(function (resolve, reject) {
        request.head(file_url, function (err, response, body) {
            if (err || response.statusCode !== 200) return reject(REMOTE_NOT_FOUND_ERROR);

            resolve(request.get(file_url));
        })
    });

}

function getMultipartStream(req) {

    return new Promise(function (resolve, reject) {

        req.busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
            if (fieldname !== 'file') return file.resume();

            let filepath = path.join(__dirname, '..', 'tmp', uid() + '.tmp'),
                write = fs.createWriteStream(filepath);

            file.pipe(write);

            write.on('finish', function () {
                let read = fs.createReadStream(filepath);

                resolve(read);

                read.on('end', function () {
                    fs.unlink(filepath, noop);
                });

            });

        });

        req.pipe(req.busboy);
    });

}

function calculateSha1(input) {
    let sha1 = crypto.createHash('sha1');

    if (typeof input === "string") {
        sha1.update(input);
        return sha1.digest('hex');
    }

    return new Promise(function (resolve, reject) {

        input.on('data', function (data) {
            sha1.update(data, 'utf8')
        });

        input.on('end', function () {
            resolve(sha1.digest('hex'));
        });

    })

}

function uploadToBulb(stream) {
    let formData = {
        file: {
            value: stream,
            options: {}
        }
    };

    if (stream._mimetype) {
        formData.file.options.contentType = stream._mimetype;
    }

    return new Promise(function (resolve, reject) {
        var req = request.post({
            url: BULB_URL,
            formData: formData
        }, function (err, response, body) {
            if (err || response.statusCode !== 200) return reject();

            resolve(body);
        });

        req.on('request', function () {
            rejectDelay(BULB_RESPONSE_TIMEOUT, BULB_RESPONSE_TIMEOUT_ERROR).then(null, reject);
        });

    });

}

function handleRoute(req, res) {
    let body = req.body || [],
        promises = [];

    if (req.busboy) {
        promises.push(
            getMultipartStream(req),
            rejectDelay(DOWNLOAD_TIMEOUT, DOWNLOAD_TIMEOUT_ERROR)
        );
    } else {
        promises.push(Promise.all(body.map(getRemoteStream)));
        promises.unshift(rejectDelay(DOWNLOAD_TIMEOUT, DOWNLOAD_TIMEOUT_ERROR));
    }

    Promise.race(promises).then(function (streams) {
            if (!Array.isArray(streams)) streams = [streams];

            return Promise.all(streams.map(function (stream) {
                return Promise.all([uploadToBulb(stream), calculateSha1(stream)]);
            }));

        }, function (reason) {
            let error = new Error;

            if (reason === DOWNLOAD_TIMEOUT_ERROR) {
                error.statusCode = 504;
            } else if (reason === REMOTE_NOT_FOUND_ERROR) {
                error.statusCode = 404;
            }

            throw error;

        })
        .then(function (results) {

            var response = results.map(function (file_hashes) {
                return calculateSha1(file_hashes[0] + file_hashes[1]);
            });

            res
                .status(200)
                .json(response);

        }, function (reason) {
            if (reason instanceof Error) throw reason;

            let error = new Error();

            if (reason === BULB_RESPONSE_TIMEOUT_ERROR) {
                error.statusCode = 504;
            } else {
                error.statusCode = 500;
            }

            throw error;

        })
        .catch(function (e) {
            console.log(e);


            res.sendStatus(e.statusCode || 500);
        });
}

function uid() {
    return crypto.randomBytes(Math.ceil(20 / 2)).toString('hex').slice(0, 20);
}

function noop() {
}