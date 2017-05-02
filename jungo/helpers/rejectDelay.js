module.exports = rejectDelay;

function rejectDelay(duration, rejectArg) {

    return new Promise(function (resolve, reject) {
        setTimeout(reject, duration, rejectArg)
    });

}