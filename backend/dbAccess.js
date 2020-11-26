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

//adds a plant to the plants table (and adds a user if the user that is sent to the function does not exist)
function addPlant(client, user, next){
    client.query('SELECT id FROM users WHERE id = $1', [user], function (err, results) {
        if (err){
            return next(err);
        } else if (results.rows.length === 0) {
            //creates a new user with the specified id if one does not exist
            client.query('INSERT INTO users(id) VALUES ($1)', [user]);
        }

        async.waterfall([
            function (next){
                //adds a new plant owned by the specified user to the table
                client.query('INSERT INTO plants(owner) VALUES ($1)', [user], next);
            },
            function (updateResult, next){
                //increases the plant count for the user
                client.query('UPDATE users SET plantCt = plantCt + 1 WHERE id = $1', [user], next);
            },
            function(updateResult, next){
                //retrieves all information from the plant table to return as results
                console.log('updating');
                client.query('SELECT * FROM plants', function(err, selectResult){
                    next(err, selectResult ? selectResult.rows : null);
                });
            }
        ], next);
    });
}

//adds an amount watered to a plant's log for a specified date (and creates a log for that date if one doesn't already exist)
function logWater(client, plantid, amount, date, next){
    client.query('SELECT plantid FROM water_log WHERE plantid = $1 AND date = $2', [plantid, date], function (err, results) {
        if (err){
            return next(err);
        } else if (results.rows.length === 0) {
            //add log for date if one doesn't exist
            client.query('INSERT INTO water_log(plantid, date) VALUES ($1, $2)', [plantid, date]);
        }

        async.waterfall([
            function (next){
                //add amount watered
                client.query('UPDATE water_log SET water_amt = water_amt + $1 WHERE plantid = $2 AND date = $3', [amount, plantid, date], next);
            },
            function(updateResult, next){
                //retrieves table to send back as results
                client.query('SELECT * FROM water_log', function(err, selectResult){
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
        err
    }
    txnWrapper(client,
        function (client, next){
            //logs 8 ounces of water on november 12, 2020 for the plant with this id
            logWater(client, '00f08f4f-68f6-43cb-966a-2f0bf3c910d0', 8, '2020-11-12', next);
        },
        function (results){
            if (err) {
                console.error('error performing transaction', err);
                finish();
            }
            //prints out a list of all of the water logs in the table
            console.log('Logs:');
            results.forEach(function(result){
                console.log(result);
            });
            finish();
        });
    });

/*
pool.connect(function (err, client, done){
    //closes communication with db and exits
    var finish = function (){
        done();
        process.exit();
    };

    if (err){
        console.error('could not connect to cockroachdb', err);
        finish();
        err

    }
    txnWrapper(client,
        function (client, next){
            //adds a plant with owner 'test' to the table
            addPlant(client, 'test', next);
            console.log('adding');
        },
        function (results){
            if (err) {
                console.error('error performing transaction', err);
                finish();
            }
            //prints out the plants in the table after adding the new one
            console.log('Plants after addition:');
            results.forEach(function(result){
                console.log(result);
            });
            finish();
        });
    });
    */
