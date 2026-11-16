import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSetup } from './setup.js';
import { NFLPlays, describePlay, distinctShortName, gainedOn, namePattern, readPlay, scoredTouchdown } from '../src/providers/plays.js';

// Every play text here is copied from ESPN's play-by-play for the games of November 13–15, 2026.

test('notes ESPN puts in front of a play are skipped', () => {
  const cases = [
    ['(14:12) (Shotgun) C.Klubnik pass deep right to G.Wilson to BUF 32 for 29 yards (A.Hooker).', 'Garrett Wilson', 'G. Wilson caught pass for 29 yards'],
    ['W.Sherman reported in as eligible.  T.Shough pass short left to A.Estime to CAR 41 for 5 yards (C.Smith-Wade).', 'Audric Estime', 'A. Estime caught pass for 5 yards'],
    ['J.Kingston reported in as eligible.  O.Gordon right end to IND 35 for 7 yards (A.Haulcy).', 'Ollie Gordon II', 'O. Gordon ran for 7 yards'],
    ['(Shotgun) Direct snap to T.Etienne.  T.Etienne left guard to CAR 15 for 4 yards (L.Hunter; T.Dodson).', 'Travis Etienne Jr.', 'T. Etienne ran for 4 yards'],
    ['(Shotgun) Direct snap to T.Kraft.  J.Love pass short right to C.Watson to MIN 29 for 15 yards (J.Metellus).', 'Christian Watson', 'C. Watson caught pass for 15 yards'],
    ['C.Tiernan reported in as eligible.  A.Jones left end for 1 yard, TOUCHDOWN. W.Reichard extra point is GOOD, Center-A.DePaola, Holder-B.Thorson.', 'Aaron Jones Sr.', 'A. Jones ran for 1 yard, touchdown'],
  ];
  for (const [text, name, want] of cases) assert.equal(describePlay(text, name), want, text);
});

test('runs, catches and spots ESPN writes in less common ways', () => {
  assert.equal(describePlay('(Shotgun) A.Kamara to CAR 26 for 1 yard (J.Phillips; D.Brown).', 'Alvin Kamara'), 'A. Kamara ran for 1 yard');
  assert.equal(describePlay('C.Ward pass short right to G.Helm pushed ob at 50 for 9 yards (T.Walker).', 'Gunnar Helm'), 'G. Helm caught pass for 9 yards');
  assert.equal(describePlay('J.McCarthy pass short middle to I.Likely to 50 for 11 yards (F.Luvu; Q.Martin).', 'Isaiah Likely'), 'I. Likely caught pass for 11 yards');
  assert.equal(describePlay('(No Huddle, Shotgun) T.Shough pass short right to J.Tyson to NO 40 for no gain (C.Smith-Wade).', 'Jordyn Tyson'), 'J. Tyson caught pass for no gain');
  assert.equal(describePlay('C.Skattebo up the middle to WAS 15 for no gain (N.Cross; S.Tuttle).', 'Cam Skattebo'), 'C. Skattebo ran for no gain');
  // A pass thrown "short middle" and intercepted isn't a run for the return yards.
  const pick = '(No Huddle, Shotgun) T.Lawrence pass short middle intended for J.Meyers INTERCEPTED by C.Gray (S.Thomas) at TEN 25. C.Gray to 50 for 25 yards (C.Van Lanen).';
  assert.equal(gainedOn(pick, 'Trevor Lawrence'), false);
});

test('ESPN spells out more of a first name to tell two players apart', () => {
  assert.ok(namePattern('Brian Thomas Jr.').test('T.Lawrence pass short left to Bri.Thomas to TEN 40 for 11 yards (C.Flott).'));
  assert.ok(namePattern('Daniel Jones').test('Da.Jones pass short right'));
  assert.ok(namePattern('Daniel Jones').test('D.Jones pass short right'));
  assert.ok(!namePattern('Daniel Jones').test('Dr.Jones up the middle'));
  assert.equal(describePlay('(No Huddle, Shotgun) T.Lawrence pass short left to Bri.Thomas to TEN 40 for 11 yards (C.Flott).', 'Brian Thomas Jr.'), 'B. Thomas caught pass for 11 yards');
});

test('only the call that stood counts after a replay review or a penalty', () => {
  // Completion overturned to an incompletion.
  const overturned = '(Shotgun) C.Klubnik pass short left to A.Mitchell to NYJ 39 for 13 yards (M.Hairston).Buffalo challenged the pass completion ruling, and the play was REVERSED.(Shotgun) C.Klubnik pass incomplete short left to A.Mitchell.';
  assert.equal(gainedOn(overturned, 'Adonai Mitchell'), false);
  assert.equal(readPlay(overturned).main, '(Shotgun) C.Klubnik pass incomplete short left to A.Mitchell.'.replace('(Shotgun) ', ''));
  // Spot changed on review: the yards that stood.
  const spot = '(Shotgun) K.McCord pass short left to O.Gordon to IND 45 for 10 yards (L.Latu).Indianapolis challenged the first down ruling, and the play was REVERSED.(Shotgun) K.McCord pass short left to O.Gordon to IND 46 for 9 yards (L.Latu).';
  assert.equal(describePlay(spot, 'Ollie Gordon II'), 'O. Gordon caught pass for 9 yards');
  // Wiped out by a penalty.
  const noPlay = 'J.Goff pass short left to A.St. Brown to DET 36 for 15 yards (G.Jacas).PENALTY on DET-I.TeSlaa, Offensive Pass Interference, 10 yards, enforced at DET 21 - No Play.';
  assert.equal(gainedOn(noPlay, 'Amon-Ra St. Brown'), false);
  const offsetting = '(Shotgun) K.Williams left end pushed ob at DET 47 for 21 yards (B.Branch).Penalty on NE-D.Douglas, Offensive Holding, offsetting, enforced at NE 32 - No Play.Penalty on DET-R.Ya-Sin, Face Mask, offsetting.';
  assert.equal(gainedOn(offsetting, 'Kyle Williams'), false);
  const nullified = '(Shotgun) T.DeVito pass short right to L.Larison for 20 yards, TOUCHDOWN NULLIFIED by Penalty.PENALTY on NE-E.Chism, Offensive Pass Interference, 10 yards, enforced at DET 20 - No Play.';
  assert.equal(scoredTouchdown(nullified, 'Lan Larison'), false);
  // A penalty after the play doesn't take it away, and isn't part of the sentence.
  const after = '(Shotgun) T.Shough pass deep middle to J.Tyson to CAR 34 for 18 yards (Z.Wheatley).PENALTY on CAR-D.Lloyd, Unnecessary Roughness, 15 yards, enforced at CAR 34.';
  assert.equal(describePlay(after, 'Jordyn Tyson'), 'J. Tyson caught pass for 18 yards');
});

test('the extra point and two-point try in a touchdown\'s text belong to the kicker and the try, not the touchdown', () => {
  const td = 'A.Stinnie reported in as eligible.  C.Skattebo right guard for 1 yard, TOUCHDOWN. D.Zvada extra point is GOOD, Center-B.Mann, Holder-J.Stout.';
  assert.equal(describePlay(td, 'Cam Skattebo'), 'C. Skattebo ran for 1 yard, touchdown');
  assert.equal(scoredTouchdown(td, 'Cam Skattebo'), true);
  assert.equal(describePlay(td, 'Dominic Zvada'), 'D. Zvada made extra point');
  assert.equal(scoredTouchdown(td, 'Dominic Zvada'), false, 'the kicker gets no Touchdown! alert');

  const pass = '(Shotgun) J.Daniels pass short middle to B.Sinnott for 1 yard, TOUCHDOWN [A.Carter]. D.Stevens extra point is GOOD, Center-T.Ott, Holder-T.Way.';
  assert.equal(scoredTouchdown(pass, 'Jayden Daniels'), true);
  assert.equal(scoredTouchdown(pass, 'Ben Sinnott'), true);
  assert.equal(scoredTouchdown(pass, 'Dalton Stevens'), false);

  // A failed try earns nothing. (Today's only try failed; the succeeding ones follow ESPN's usual wording.)
  const failed = '(Shotgun) K.McCord up the middle for 3 yards, TOUCHDOWN.PENALTY on IND-A.Adebawore, Face Mask, 1 yard, enforced between downs. TWO-POINT CONVERSION ATTEMPT. K.McCord pass to G.Dulcich is incomplete. ATTEMPT FAILS.';
  assert.equal(describePlay(failed, 'Kyle McCord'), 'K. McCord ran for 3 yards, touchdown');
  assert.equal(gainedOn(failed, 'Greg Dulcich'), false);
  const caught = '(Shotgun) J.Hurts pass short right to D.Goedert for 5 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Hurts pass to A.Brown is complete. ATTEMPT SUCCEEDS.';
  assert.equal(describePlay(caught, 'A.J. Brown'), 'A. Brown caught two-point conversion');
  assert.equal(scoredTouchdown(caught, 'A.J. Brown'), false);
  const ran = '(Shotgun) J.Hurts up the middle for 2 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. S.Barkley rushes up the middle. ATTEMPT SUCCEEDS.';
  assert.equal(describePlay(ran, 'Saquon Barkley'), 'S. Barkley ran in two-point conversion');
});

test('points are credited to the play that gained them, not a newer loss', async () => {
  // Penix's 16-yard scramble, then a completion for -4 yards before his points updated.
  const fetch = async () => new Response(JSON.stringify({ drives: { current: { plays: [
    { id: '1', text: '(Shotgun) M.Penix scrambles left end to KC 16 for 16 yards (M.Delane).' },
    { id: '2', text: ' (No Huddle, Shotgun) M.Penix pass incomplete deep left to J.Dotson (M.Delane).' },
    { id: '3', text: ' (No Huddle, Shotgun) M.Penix pass short middle to B.Robinson to KC 20 for -4 yards (A.Gillotte).' },
  ] } } }));
  const plays = new NFLPlays({ fetch, ttl: 0 });
  assert.equal((await plays.latestFor('401873058', 'Michael Penix Jr.')).id, '1');
  // A catch for a loss still earns a point in PPR, so it counts for the receiver.
  assert.equal((await plays.latestFor('401873058', 'Bijan Robinson')).id, '3');
});

test('points posted in pieces add up on one play instead of a second event', async () => {
  const { feed, state, advance } = liveSetup();
  await feed.poll();
  state.plays = [{ id: '7', text: '(Shotgun) P.Mahomes pass short left to T.Kelce for 18 yards, TOUCHDOWN. H.Butker extra point is GOOD, Center-J.Winchester, Holder-M.Araiza.', type: { text: 'Passing Touchdown' } }];
  state.mahomes = 28.3;                      // the touchdown first
  advance(31000);
  await feed.poll();
  state.mahomes = 29.02;                     // the yards a poll later
  advance(31000);
  await feed.poll();
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0].kind, 'touchdown');
  assert.equal(feed.events[0].points, 4.72);
  assert.equal(feed.pendingTouchdowns[0].points, 4.72, 'the queued Touchdown! slide shows the whole play');
});

test('two players ESPN writes the same way are told apart by the team with the ball', async () => {
  // CAR at NO: Trevor Etienne (CAR) and Travis Etienne Jr. (NO) are both "T.Etienne".
  const fetch = async () => new Response(JSON.stringify({
    header: { competitions: [{ competitors: [{ id: '18', team: { abbreviation: 'NO' } }, { id: '29', team: { abbreviation: 'CAR' } }] }] },
    boxscore: { players: [{ statistics: [{ name: 'receiving', athletes: [{ athlete: { displayName: 'Travis Etienne Jr.' } }, { athlete: { displayName: 'Trevor Etienne' } }] }] }] },
    drives: { current: { plays: [
      { id: '1', start: { team: { id: '29' } }, text: '(Shotgun) B.Young pass short left to T.Etienne to NO 41 for 6 yards (J.Sanker).' },
      { id: '2', start: { team: { id: '18' } }, text: '(Shotgun) T.Shough pass short right to T.Etienne to NO 10 for 6 yards (T.Dodson).' },
    ] } } }));
  const plays = new NFLPlays({ fetch, ttl: 0 });
  assert.equal((await plays.latestFor('401873055', 'Trevor Etienne', 'CAR')).id, '1');
  assert.equal((await plays.latestFor('401873055', 'Travis Etienne Jr.', 'NO')).id, '2');
  assert.equal((await plays.latestFor('401873055', 'Trevor Etienne')).id, '2', 'without a team, the latest');
  // The app writes them so you can tell which is which.
  assert.equal((await plays.latestFor('401873055', 'Trevor Etienne', 'CAR')).shortName, 'Tre. Etienne');
  assert.equal((await plays.latestFor('401873055', 'Travis Etienne Jr.', 'NO')).shortName, 'Tra. Etienne');
  assert.equal(distinctShortName('Josh Allen', ['Josh Allen', 'Garrett Wilson']), 'J. Allen');
});

test('a touchdown catch followed by the two-point catch counts both', () => {
  const text = '(Shotgun) A.Rodgers pass deep left to D.Metcalf for 22 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. A.Rodgers pass to D.Metcalf is complete. ATTEMPT SUCCEEDS.';
  assert.equal(describePlay(text, 'DK Metcalf'), 'D. Metcalf caught pass for 22 yards, touchdown and two-point conversion');
  assert.equal(scoredTouchdown(text, 'DK Metcalf'), true);
});
