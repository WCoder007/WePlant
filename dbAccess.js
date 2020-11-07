var async = require('async');
var fs = require('fs');
var pg = require('pg');

var config = {
    user: 'babesgotbytes',
    password: 'techTogether2020',
    host: 'weplant-646.gcp-us-west2.cockroachlabs.cloud',
    database: 'weplantdb',
    port: 26257,
    ssl: {
        ca: fs.readFileSync('/home/sarah/certs/weplant-ca.crt').toString(),
    }
}

var pool = new pg.Pool(config);
pool.connect(function (err, client, done){
    var finish = function (){
        done();
        process.exit();
    };

    if (err){
        console.error('could not connect to cockroachdb', err);
        finish();
    }
    async.waterfall([
        function (next){
            client.query('CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY, level INT DEFAULT 1, points INT DEFAULT 0);', next);
        },
        function(results, next){
            client.query('SELECT id, level, points FROM users;', next);
        },
    ],
    function (err, results) {
        if (err) {
            console.error('Error inserting into and selecting from accounts: ', err);
            finish();
        }
        
        console.log('Users:');
        results.rows.forEach(function (row) {
            console.log(row);
        });
        finish();
    });
});