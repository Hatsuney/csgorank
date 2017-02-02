import * as async from 'async';
import * as cli from 'cli-color';
import * as CSGO from 'csgo';
import * as fs from 'fs';
import * as http from 'http-request';
import * as Steam from 'steam';
import * as totp from 'steam-totp';

import {exec} from 'child_process';

var Config = require('./config.json');

var mapPattern = new RegExp('http://replay[0-9]+.valve.net/730/(.+).dem.bz2');

console.log(cli.cyanBright('[csgorank] ') + 'Let\'s go with this bullshit.');

console.log(cli.cyanBright('[csgorank] ') + 'Found ' + Config.accounts.length + ' account(s).');
async.eachSeries(Config.accounts, function(account, accountCallback) {
	console.log(cli.cyanBright('[csgorank] ') + 'Setting up Steam stuff for account: ' + cli.yellowBright(account.username) + '...')
	var steamClient = new Steam.SteamClient();
	var steamGC = new Steam.SteamGameCoordinator(steamClient, 730);
	var steamUser = new Steam.SteamUser(steamClient);

	steamClient.connect();

	steamClient.on('connected', function() {
		console.log(cli.yellowBright('[' + account.username + '] ') + 'Connected to Steam.');

		if('secret' in account) {
			console.log(cli.yellowBright('[' + account.username + '] ') + 'Found a 2FA secret, attempting login.');

			steamUser.logOn({
				account_name: account.username,
				password: account.password,
				two_factor_code: totp.generateAuthCode(account.secret)
			});
		} else {
			fs.exists('./sentry/' + account.username + '.ssfn', function(exists) {
				if(!exists) {
					console.log(cli.redBright('[' + account.username + '] ') + 'Unable to find a sentry file, panicking.');
				} else {
					console.log(cli.yellowBright('[' + account.username + '] ') + 'Found a sentry file, attempting login.');

					steamUser.logOn({
						account_name: account.username,
						password: account.password,
						sha_sentryfile: fs.readFileSync('./sentry/' + account.username + '.ssfn')
					});
				}
			});
		}
	});

	steamClient.on('loggedOff', function() {
		console.log(cli.yellowBright('[' + account.username + '] ') + 'Logged off from Steam.');
	})

	steamClient.on('logOnResponse', function(data) {
		if(data.eresult == Steam.EResult.OK) {
			console.log(cli.greenBright('[' + account.username + '] ') + 'Successfully logged into Steam.');
			var csgo = new CSGO.CSGOClient(steamUser, steamGC, false);

			csgo.on('ready', function() {
				console.log(cli.greenBright('[' + account.username + '] ') + cli.greenBright('[csgo] ') + 'Connected to CS:GO GC.');
				console.log(cli.greenBright('[' + account.username + '] ') + cli.greenBright('[csgo] ') + 'Requesting recent matches...');
				csgo.requestRecentGames();
			});

			csgo.on('exited', function() {
				console.log(cli.greenBright('[' + account.username + '] ') + cli.yellowBright('[csgo] ') + 'Exited CS:GO, disconnecting from Steam.');
				steamClient.disconnect();
				accountCallback();
			});

			csgo.on('matchList', function(matchList) {
				console.log(cli.greenBright('[' + account.username + '] ') + cli.greenBright('[csgo/matchlist] ') + 'Received a match list.');
				var replayList = fs.readdirSync(Config.path);

				async.eachSeries(matchList.matches, function(match, matchCallback) {
					var replayAlreadyDownloaded = false;

					if('roundstatsall' in match && 'map' in match.roundstatsall[match.roundstatsall.length - 1]) {

						var lastRoundStats = match.roundstatsall[match.roundstatsall.length - 1];
						var regexpMatches = mapPattern.exec(lastRoundStats.map);
						var matchId = regexpMatches[1];

						console.log(lastRoundStats);

						console.log(cli.greenBright('[' + account.username + '] ') + cli.yellowBright('[csgo/matchlist/' + matchId + '] ') + 'Checking if the demo file is already downloaded...');

						for(let replayId of replayList) {
							if(replayId.indexOf(matchId) > -1) {
								replayAlreadyDownloaded = true;
							}
						}

						if(!replayAlreadyDownloaded) {
							console.log(cli.greenBright('[' + account.username + '] ') + cli.yellowBright('[csgo/matchlist/' + matchId + '] ') + 'Downloading the demo file...');

							http.get(lastRoundStats.map, Config.path + '/' + matchId + '.dem.bz2', function(error, response) {
								if(!error) {
									console.log(cli.greenBright('[' + account.username + '] ') + cli.greenBright('[csgo/matchlist/' + matchId + '] ') + 'Unpacking the demo file...');
									exec('bzip2 -d ' + response.file)
								} else {
									console.log(cli.greenBright('[' + account.username + '] ') + cli.redBright('[csgo/matchlist/' + matchId + '] ') + 'Failed to download match. It\'s probably too old.');
								}
								matchCallback();
							});
						} else {
							console.log(cli.greenBright('[' + account.username + '] ') + cli.greenBright('[csgo/matchlist/' + matchId + '] ') + 'Match already downloaded, skipping.');
							matchCallback();
						}
					}
				}, function(error) {
					console.log(cli.greenBright('[' + account.username + '] ') + cli.greenBright('[csgo/matchlist] ') + 'Finished checking matches, exiting.');

					csgo.exit();
				})
			});

			console.log(cli.greenBright('[' + account.username + '] ') + cli.yellowBright('[csgo] ') + 'Connecting to CS:GO GC...');
			csgo.launch();
		}
	});

	steamClient.on('error', function(error) {
		console.log(error);
	})

}, function(err) {
	console.log(cli.cyanBright('[csgorank] ') + 'Seems like my work here is done.');
});
