var async = require('async');
var fs = require('fs');
var pg = require('pg');
const { URLSearchParams } = require('url');

//retrieve password from gitignore file
var pword = fs.readFileSync('.gitignore/password.txt').toString();

//connect to server
var config = {
    user: 'babesgotbytes',
    password: pword.substr(0, pword.length - 1),
    host: 'weplant-646.gcp-us-west2.cockroachlabs.cloud',
    database: 'weplantdb',
    port: 26257,
    ssl: {
        ca: fs.readFileSync('certs/weplant-ca.crt').toString()
    }
}

//transaction wrapper
function txnWrapper(client, op, next){
    client.query('BEGIN; SAVEPOINT cockroach_restart', function(err){
        if (err){
            return next(err);
        }

        var released = false;
        async.doWhilst(function(done){
            var handleError = function (err){
                if (err.code === '40001'){
                    return client.query('ROLLBACK TO SAVEPOINT cockroach_restart', done);
                }
                return done(err)
            };

            op(client, function (err){
                if (err){
                    return handleError(err);
                }
                var opResults = arguments;

                client.query('RELEASE SAVEPOINT cockroach_restart', function (err){
                    if (err) {
                        return handleError(err);
                    }
                    released = true;
                    return done.apply(null, opResults);
                });
            });
        },
        function () {
            if (err){
                client.query('ROLLBACK', function (){
                    next(err);
                });
            } else{
                var txnResults = arguments;
                client.query('COMMIT', function (err){
                    if (err){
                        return next(err);
                    } else {
                        return next.apply(null, txnResults);
                    }
                });
            }
        });
    });
}

function addPlant(client, user, next){
    client.query('SELECT id FROM users WHERE id = $1', [user], function (err, results) {
        if (err){
            return next(err);
        } else if (results.rows.length === 0) {
            console.log('adding user');
            client.query('INSERT INTO users(id) VALUES ($1)', [user]);
        }

        async.waterfall([
            function (next){
                console.log('inserting');
                client.query('INSERT INTO plants(owner) VALUES ($1)', [user], next);
                console.log('inserted');
            },
            function (updateResult, next){
                console.log('adding');
                client.query('UPDATE users SET plantCt = plantCt + 1 WHERE id = $1', [user], next);
            },
            function(updateResult, next){
                console.log('updating');
                client.query('SELECT * FROM plants', function(err, selectResult){
                    next(err, selectResult ? selectResult.rows : null);
                });
            }
        ], next);
    });
}

var pool = new pg.Pool(config);
pool.connect(function (err, client, done){
    //closes communication with db and exits
    var finish = function (){
        done();
        process.exit();
    };

    if (err){
        console.error('could not connect to cockroachdb', err);
        finish();
    }

    txnWrapper(client,
        function (client, next){
            addPlant(client, 'skswiha2', next);
        },
        function (results){
            if (err) {
                console.error('error performing transaction', err);
                finish();
            }

            console.log('Plants after addition:');
            results.forEach(function(result){
                console.log(result);
            });
            finish();
        });

    /*
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
        finish(); */
    });