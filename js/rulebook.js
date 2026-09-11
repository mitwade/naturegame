// Rulebook content, shown in the in-app Rules modal (see openRulesModal in
// app.js). Transcribed from the official rulebook PDF.
const RULEBOOK_HTML = `
<p class="rb-tagline">Build a Shared World — 2–6 players · 30–45 min · Ages 12+</p>

<h3>Overview</h3>
<p>In Nature, players act as world-builders, working together to create a massive,
shared, ever-expanding landscape. Using hexagonal terrain tiles — ranging from
frozen glaciers to fiery volcanoes — players shape the terrain to match specific
geographic patterns shown on their Nature Cards.</p>
<p>While the board is shared, points are yours alone. Strategically time your tile
placements to complete a pattern on your turn, claiming the matching card from
your private hand or the public Bank before your opponents can. Over three
increasingly tense rounds, the landscape grows, creating new opportunities for
high-scoring plays.</p>

<h3>Components</h3>
<ul>
<li><strong>Terrain Tiles</strong> — 14 tiles each of 8 terrain types (Volcano, Forest,
Ocean, Desert, Glacier, Meadow, Pond, Mountain) in a 6-player game — 112 tiles total.
<strong>The tile supply scales down with fewer players:</strong> remove 2 tiles of each
terrain for every player below 6. See "Tile Supply by Player Count" below.</li>
<li><strong>216 Nature Cards</strong>, each unique. 72 cards per pattern type (Triangle,
Elbow, Straight Line — 24 each). 24 cards built around each of the 8 terrain
types (192 total), plus 24 additional mixed-terrain cards. The card supply does
not change with player count.</li>
</ul>
<p>Each Nature Card shows a combination of 3 terrains arranged in one of three shapes:</p>
<ul>
<li><strong>Triangle</strong> (side-by-side cluster) — 1 point</li>
<li><strong>Elbow</strong> (bent shape) — 2 points</li>
<li><strong>Straight Line</strong> — 3 points</li>
</ul>

<h3>Tile Supply by Player Count</h3>
<p>Fewer players means fewer tiles of each terrain in the bag, so the board doesn't
end up drowning in a huge surplus of tiles relative to how many hands are drawing
from it. Set aside tiles you won't use before starting the game:</p>
<table class="rb-table">
<tr><th>Players</th><th>Tiles per terrain</th><th>Total tiles</th></tr>
<tr><td>6</td><td>14</td><td>112</td></tr>
<tr><td>5</td><td>12</td><td>96</td></tr>
<tr><td>4</td><td>10</td><td>80</td></tr>
<tr><td>3</td><td>8</td><td>64</td></tr>
<tr><td>2</td><td>6</td><td>48</td></tr>
</table>
<p class="rb-example">In the app, this is handled automatically based on how many
players (including bots) you set up — you only need to count out tiles by hand
for physical play.</p>

<h3>Game Setup</h3>
<ol>
<li><strong>Place the Starting Tile</strong> — 1 randomly selected terrain tile face-up in the
center of the play area.</li>
<li><strong>Prepare the Card Bank</strong> — Shuffle all 216 Nature Cards. Deal 5 face-up to
create the public Bank. Remaining deck stays face-down nearby.</li>
<li><strong>Prepare the Tile Market</strong> — Shuffle the terrain tiles for your player
count (see "Tile Supply by Player Count" above) into a face-down draw pile.
Deal 5 face-up to form the public Tile Market.</li>
<li><strong>Deal Player Hands</strong> — 3 Nature Cards each, kept hidden as a private hand.</li>
<li><strong>Deal Player Tiles</strong> — 3 terrain tiles each, placed face-up as each player's
Tile Pool — this pool is public; anyone can see what tiles their opponents hold.</li>
</ol>

<h3>Game Objective</h3>
<p>Score the most points over three rounds by completing terrain patterns from your
Nature Cards on the shared board. You don't need the most completed cards to
win — completing higher-value patterns can secure victory on its own.</p>

<h3>Turn Structure</h3>
<p>On your turn, perform exactly <strong>2 different actions</strong>. You cannot repeat the
same action twice in one turn. If you choose Draw Tiles, it must be your second
action.</p>
<ul>
<li><strong>Play Tiles</strong> — Place 1 or 2 terrain tiles from your Tile Pool onto the shared
board (at least 1 is required). Claim any completed cards immediately after
placement. Always available as long as you have at least one tile in your pool.</li>
<li><strong>Draw Cards</strong> — Draw exactly 2 Nature Cards from the face-down deck into your
private hand. <strong>Maximum hand size: 5 cards.</strong> If you have 4 cards, drawing
draws just 1 (enough to reach exactly 5) instead of 2. If you already have 5, you
cannot choose Draw Cards at all that turn — play or claim cards first to make room.</li>
<li><strong>Draw Tiles</strong> — Draw 1 or 2 tiles (your choice) from the face-up Market, the
face-down pile, or a combination. Must be your second action. Tile limit: never
more than 7 unplayed tiles in your pool — if already at 7, you can't choose this.</li>
<li><strong>Skip First Action</strong> — Pass on your first action if you'd rather not Play Tiles
or Draw Cards. This exists specifically so Draw Tiles — which can only ever be a
second action — is always reachable: if your pool is empty and your hand is
already at the 5-card cap, this is your only way to take a turn at all. You can
also use it any time you'd simply rather draw tiles than do anything else first.
Skip can only be your first action, never your second.</li>
</ul>

<h3>Tile Placement Rules</h3>
<ul>
<li><strong>First move</strong>: the very first tile placed only needs to touch the Starting Tile.</li>
<li><strong>Two-Tile Rule</strong>: every tile placed after that must touch at least two other
tiles already on the board.</li>
<li><strong>Setting up a placement</strong>: if a spot only touches one existing tile, place a
first tile there to create a valid two-tile anchor, then place your second tile
in the intended spot. A tile placed earlier in the same turn counts toward this
requirement for a tile placed later that same turn.</li>
</ul>
<p class="rb-example"><strong>Worked example:</strong> The board has two adjacent tiles, A and B.
You want to place at spot X, which only touches A. X isn't legal yet on its own.
So first place a tile at spot Y, which touches both A and your intended spot X.
Once Y is down, X now touches two tiles (A and Y) and becomes legal for your
second placement.</p>

<h3>Pattern Definitions</h3>
<p>To complete a card, you need 3 tiles on the board matching those exact terrain
types, arranged in the listed shape in any orientation (rotated, mirrored, or
upside down) — with your own tile as the one that completes the arrangement on
your turn.</p>
<ul>
<li><strong>Triangle</strong> — all three tiles mutually touch each other, forming a tight
cluster meeting at a single shared corner.</li>
<li><strong>Elbow</strong> — a connected chain (tile 1 – tile 2 – tile 3) that bends; tile 3 is
not directly opposite tile 1 across tile 2.</li>
<li><strong>Straight Line</strong> — a connected chain running the same direction the whole
way; tile 3 is directly opposite tile 1 across tile 2.</li>
</ul>

<h3>The Card Bank, Private Hand &amp; Claiming Cards</h3>
<ul>
<li><strong>The Deck</strong> — the face-down draw pile, unseen by anyone.</li>
<li><strong>The Bank</strong> — 5 face-up public cards anyone can see and claim. Doesn't refill
during a round — stays at whatever count until the end-of-round reset.</li>
<li><strong>Your Private Hand</strong> — cards drawn via Draw Cards. Only you can see these.</li>
</ul>
<p><strong>Claiming a card:</strong> you must be the active player, and the tile that completes
the pattern must be placed on your turn. You may claim using a card from your own
hand or directly from the Bank — no need to draw a Bank card first. Multiple cards
may be claimed in one turn if more than one pattern is completed. First-come,
first-served: once a card is claimed, it's gone. No retroactive claims — a
pattern that exists on the board but nobody claimed at the time is a missed
opportunity; you must complete it yourself, on your own turn.</p>

<h3>Round Structure &amp; Triggers</h3>
<p>Nature is played over 3 rounds. The board persists and grows throughout all three.</p>
<ul>
<li>Round 1 ends when a player completes their 3rd card total.</li>
<li>Round 2 ends when a player completes their 4th card of that round.</li>
<li>Round 3 ends when a player completes their 5th card of that round.</li>
</ul>
<p>Cards completed in previous rounds don't count toward a later round's requirement
— each round's count resets to zero.</p>

<h3>Final Turn &amp; Round Cleanup</h3>
<ol>
<li>Finish the turn order so every player gets an equal number of turns that round.</li>
<li>Score all completed cards; keep them in your scoring pile.</li>
<li>The player who ended the round starts the next round.</li>
<li>Discard piles are created: each player's remaining Tile Pool goes to the tile
discard pile, each player's remaining private hand goes to the card discard
pile, and any cards still in the Bank clear to the card discard pile too.</li>
<li>Deal 5 new cards from the deck to refill the Bank.</li>
<li>Deal each player 3 new tiles and 3 new Nature Cards.</li>
</ol>
<p><strong>Running out of tiles or cards:</strong> reshuffle the matching discard pile to form a
new draw pile. If there's nothing left in either the deck or its discard pile,
finish the current turn order and end the game.</p>

<h3>End Game &amp; Scoring</h3>
<p>After Round 3 ends and final turns are complete, calculate each player's total
points across all three rounds. The player with the most points wins.</p>
<p><strong>Tiebreaker:</strong> ties are broken by whoever completed the most cards overall,
across all three rounds. If still tied, the players share the win.</p>
`;
