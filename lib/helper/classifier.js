var self = module.exports = {
    getLastTrainedMailWasSavedOn: function(r) {
        return r.table('bayesStore')
        .get('lastTrainedMailWasSavedOn')
        .run(r.conn)
        .then(function(last) {
            if (last === null) {
                return null;
            }
            return last.value;
        })
        .catch(function(e) {
            return null;
        })
    },
    acquireLock: function(r) {
        return r.table('bayesStore')
        .insert({
            key: 'trainLock',
            value: true
        }, {
            conflict: 'error'
        })
        .run(r.conn)
        .then(function(result) {
            if (result.errors > 0) return false;
            return true;
        })
        .catch(function(e) {
            return false;
        })
    },
    releaseLock: function(r) {
        return r.table('bayesStore')
        .get('trainLock')
        .delete()
        .run(r.conn)
        .then(function(result) {
            if (result.errors > 0) return false;
            return true;
        })
        .catch(function(e) {
            return false;
        })
    },
    dne: function(r, userId) {
        return require('./notification').sendAlert(r, userId, 'error', 'Filter needs to be trained initially.')
    }
}
