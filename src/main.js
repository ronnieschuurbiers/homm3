// ═══════════════════════════════════════════════════════════════════
// HoMM3-style portrait battle – iPhone optimised (390 × 844)
// Red player at top · Blue player at bottom
// ═══════════════════════════════════════════════════════════════════

// ── Canvas / grid ─────────────────────────────────────────────────
const GAME_WIDTH = 390;
const GAME_HEIGHT = 844;
const COLS = 7;
const ROWS = 11;
const HEX_SIZE = 28;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE; // ≈ 48.5
const HEX_HEIGHT_STEP = HEX_SIZE * 1.5; // 42

// Centre the grid horizontally: equal left/right margins
// leftEdge  = BOARD_ORIGIN_X - HEX_WIDTH/2
// rightEdge = BOARD_ORIGIN_X + COLS*HEX_WIDTH  (odd row extends HEX_WIDTH/2 further)
// equal margins ⟹ BOARD_ORIGIN_X = (GAME_WIDTH - (COLS - 0.5)*HEX_WIDTH) / 2
const BOARD_ORIGIN_X = Math.round((GAME_WIDTH - (COLS - 0.5) * HEX_WIDTH) / 2);
const BOARD_ORIGIN_Y = 90;

// ── Unit type definitions ──────────────────────────────────────────
const UNIT_DEFS = {
  swordsman: { name: "Sword", hp: 100, damage: 15, speed: 3, ranged: false },
  archer: { name: "Archer", hp: 60, damage: 20, speed: 2, ranged: true, range: 5 },
  knight: { name: "Knight", hp: 150, damage: 25, speed: 5, ranged: false },
};

// Distinct colour per (side × type) so all six stacks look different
const UNIT_COLORS = {
  blue: { swordsman: 0x1565c0, archer: 0x00838f, knight: 0x6a1b9a },
  red: { swordsman: 0xb71c1c, archer: 0xe65100, knight: 0x880e4f },
};

// Starting stacks
const INITIAL_UNITS = [
  // Blue (bottom)
  { id: "b_sword", side: "blue", type: "swordsman", col: 1, row: 9, count: 20 },
  { id: "b_arch", side: "blue", type: "archer", col: 3, row: 9, count: 15 },
  { id: "b_knt", side: "blue", type: "knight", col: 5, row: 9, count: 10 },
  // Red (top)
  { id: "r_sword", side: "red", type: "swordsman", col: 1, row: 1, count: 20 },
  { id: "r_arch", side: "red", type: "archer", col: 3, row: 1, count: 15 },
  { id: "r_knt", side: "red", type: "knight", col: 5, row: 1, count: 10 },
];

// ── Hex math ───────────────────────────────────────────────────────
function tileCenter(col, row) {
  return {
    x: BOARD_ORIGIN_X + col * HEX_WIDTH + (row % 2) * (HEX_WIDTH / 2),
    y: BOARD_ORIGIN_Y + row * HEX_HEIGHT_STEP,
  };
}

function hexPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = Phaser.Math.DegToRad(60 * i - 30);
    pts.push(new Phaser.Math.Vector2(cx + size * Math.cos(a), cy + size * Math.sin(a)));
  }
  return pts;
}

// Offset → cube coordinates (odd-row offset)
function offsetToCube(col, row) {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  return { x, y: -x - z, z };
}

function hexDistance(c1, r1, c2, r2) {
  const a = offsetToCube(c1, r1);
  const b = offsetToCube(c2, r2);
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

function hexNeighbors(col, row) {
  const dirs =
    row % 2 === 0
      ? [
          [-1, 0],
          [1, 0],
          [-1, -1],
          [0, -1],
          [-1, 1],
          [0, 1],
        ]
      : [
          [-1, 0],
          [1, 0],
          [0, -1],
          [1, -1],
          [0, 1],
          [1, 1],
        ];
  return dirs
    .map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
    .filter(({ col: c, row: r }) => c >= 0 && c < COLS && r >= 0 && r < ROWS);
}

// BFS: all empty tiles reachable within `speed` steps
function getReachableTiles(col, row, speed, allUnits) {
  const occupied = new Set(
    allUnits.filter((u) => u.count > 0).map((u) => `${u.col},${u.row}`),
  );
  const visited = new Set([`${col},${row}`]);
  const result = [];
  let frontier = [{ col, row }];

  for (let step = 1; step <= speed; step += 1) {
    const next = [];
    for (const { col: c, row: r } of frontier) {
      for (const nb of hexNeighbors(c, r)) {
        const key = `${nb.col},${nb.row}`;
        if (!visited.has(key) && !occupied.has(key)) {
          visited.add(key);
          next.push(nb);
          result.push(nb);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────

// Current HP of the weakest individual in the stack (used for display)
function hpPerUnit(unit) {
  return unit.count > 0 ? Math.ceil(unit.totalHp / unit.count) : 0;
}

// Recalculate how many individual units survive after a totalHp change
function recalcCount(unit) {
  unit.count = Math.max(0, Math.ceil(unit.totalHp / unit.def.hp));
}

// ═══════════════════════════════════════════════════════════════════
// Scene
// ═══════════════════════════════════════════════════════════════════
class BattlefieldScene extends Phaser.Scene {
  constructor() {
    super("BattlefieldScene");
    this.hexLayer = null;
    this.highlightLayer = null;
    this.unitLayer = null;

    this.units = [];
    this.currentTurn = "blue"; // 'blue' | 'red'
    this.selectedUnit = null;
    this.moveTiles = []; // reachable empty tiles
    this.atkTargets = []; // ids of attackable enemies

    this.gameOver = false;

    // UI text objects (populated in buildUI)
    this.turnBarBg = null;
    this.turnTxt = null;
    this.infoTxt = null;
    this.redStatsTxt = null;
    this.blueStatsTxt = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────
  create() {
    this.cameras.main.setBackgroundColor("#0e1626");

    // Rendering layers (order: grid → highlights → units)
    this.hexLayer = this.add.graphics();
    this.highlightLayer = this.add.graphics();
    this.unitLayer = this.add.layer();

    this.buildGrid();

    this.units = INITIAL_UNITS.map((u) => this.initUnit(u));
    this.units.forEach((u) => this.drawUnit(u));

    this.buildUI();
    this.updateTurnBar();
    this.registerInput();
  }

  // ── Grid ─────────────────────────────────────────────────────────
  buildGrid() {
    this.hexLayer.clear();
    this.hexLayer.lineStyle(1, 0x5a7a50, 0.45);
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const { x, y } = tileCenter(col, row);
        const shade = (col + row) % 2 === 0 ? 0x2a4a2e : 0x243f28;
        this.hexLayer.fillStyle(shade, 0.55);
        const pts = hexPoints(x, y, HEX_SIZE);
        this.hexLayer.fillPoints(pts, true);
        this.hexLayer.strokePoints(pts, true);
      }
    }
  }

  // ── Unit data model ───────────────────────────────────────────────
  initUnit(data) {
    const def = UNIT_DEFS[data.type];
    return {
      ...data,
      def,
      totalHp: data.count * def.hp,
      maxTotalHp: data.count * def.hp,
      // Display objects (null until drawUnit)
      gfx: null,
      nameTxt: null,
      atkTxt: null,
      countTxt: null,
      hpTxt: null,
    };
  }

  // Draw (or redraw) a unit's hex representation at its current grid position
  drawUnit(unit) {
    // Destroy old display objects
    for (const k of ["gfx", "nameTxt", "atkTxt", "countTxt", "hpTxt"]) {
      if (unit[k]) {
        unit[k].destroy();
        unit[k] = null;
      }
    }
    if (unit.count <= 0) return; // eliminated – leave no graphics

    const { x, y } = tileCenter(unit.col, unit.row);
    const fillColor = UNIT_COLORS[unit.side][unit.type];
    const isSelected = this.selectedUnit?.id === unit.id;

    // ── Hex background ──
    const gfx = this.add.graphics();
    const pts = hexPoints(x, y, HEX_SIZE - 1);
    gfx.fillStyle(fillColor, 0.92);
    gfx.fillPoints(pts, true);
    gfx.lineStyle(isSelected ? 3 : 2, isSelected ? 0xf5d742 : 0x000000, isSelected ? 1 : 0.7);
    gfx.strokePoints(pts, true);
    this.unitLayer.add(gfx);
    unit.gfx = gfx;

    const baseStyle = {
      fontFamily: "Arial",
      stroke: "#000000",
      strokeThickness: 2,
    };

    // ── Unit type + ATK (top of hex) ──
    const atkTxt = this.add.text(x, y - 11, `${unit.def.name.slice(0, 3).toUpperCase()} ⚔${unit.def.damage}`, {
      ...baseStyle,
      fontSize: "8px",
      color: "#ffffffcc",
    });
    atkTxt.setOrigin(0.5, 0.5);
    this.unitLayer.add(atkTxt);
    unit.atkTxt = atkTxt;

    // ── Count (centre, large) ──
    const countTxt = this.add.text(x, y + 1, String(unit.count), {
      fontFamily: "Arial Black, Arial",
      fontSize: "14px",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
    });
    countTxt.setOrigin(0.5, 0.5);
    this.unitLayer.add(countTxt);
    unit.countTxt = countTxt;

    // ── HP per unit (bottom of hex) ──
    const hp = hpPerUnit(unit);
    const hpColor =
      hp > unit.def.hp * 0.5 ? "#88ff88" : hp > unit.def.hp * 0.2 ? "#ffff44" : "#ff6666";
    const hpTxt = this.add.text(x, y + 13, `♥${hp}`, {
      ...baseStyle,
      fontSize: "8px",
      color: hpColor,
    });
    hpTxt.setOrigin(0.5, 0.5);
    this.unitLayer.add(hpTxt);
    unit.hpTxt = hpTxt;
  }

  // ── UI panels ─────────────────────────────────────────────────────
  buildUI() {
    // ── Top bar – Red player ──
    this.add.rectangle(0, 0, GAME_WIDTH, BOARD_ORIGIN_Y - 4, 0x1a0808, 1).setOrigin(0, 0);
    this.add
      .text(GAME_WIDTH / 2, 6, "▲  RED PLAYER", {
        fontFamily: "Arial Black, Arial",
        fontSize: "14px",
        color: "#ff7070",
      })
      .setOrigin(0.5, 0);
    this.redStatsTxt = this.add
      .text(GAME_WIDTH / 2, 26, "", {
        fontFamily: "Arial",
        fontSize: "10px",
        color: "#ffaaaa",
        align: "center",
      })
      .setOrigin(0.5, 0);

    // ── Bottom bar – Blue player + turn indicator ──
    const barY = BOARD_ORIGIN_Y + (ROWS - 1) * HEX_HEIGHT_STEP + HEX_SIZE + 10;
    const barH = GAME_HEIGHT - barY;

    this.turnBarBg = this.add.rectangle(0, barY, GAME_WIDTH, barH, 0x08182a, 1).setOrigin(0, 0);

    this.add
      .text(GAME_WIDTH / 2, barY + 6, "▼  BLUE PLAYER", {
        fontFamily: "Arial Black, Arial",
        fontSize: "14px",
        color: "#7ab0ff",
      })
      .setOrigin(0.5, 0);
    this.blueStatsTxt = this.add
      .text(GAME_WIDTH / 2, barY + 26, "", {
        fontFamily: "Arial",
        fontSize: "10px",
        color: "#aaccff",
        align: "center",
      })
      .setOrigin(0.5, 0);

    // Divider
    const div = this.add.graphics();
    div.lineStyle(1, 0x445566, 0.8);
    div.lineBetween(12, barY + 50, GAME_WIDTH - 12, barY + 50);

    // Whose-turn text
    this.turnTxt = this.add
      .text(GAME_WIDTH / 2, barY + 56, "", {
        fontFamily: "Arial Black, Arial",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5, 0);

    // Info / instruction line
    this.infoTxt = this.add
      .text(GAME_WIDTH / 2, barY + 78, "", {
        fontFamily: "Arial",
        fontSize: "11px",
        color: "#cccccc",
        align: "center",
        wordWrap: { width: GAME_WIDTH - 20 },
      })
      .setOrigin(0.5, 0);

    // Skip-turn button
    const btnY = barY + 118;
    const skipBtn = this.add
      .rectangle(GAME_WIDTH / 2, btnY, 130, 30, 0x334455, 1)
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(GAME_WIDTH / 2, btnY, "SKIP TURN", {
        fontFamily: "Arial",
        fontSize: "11px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5, 0.5);
    skipBtn.on("pointerdown", () => {
      if (!this.gameOver) {
        this.deselectUnit();
        this.endTurn();
      }
    });
    skipBtn.on("pointerover", () => skipBtn.setFillStyle(0x4a6880));
    skipBtn.on("pointerout", () => skipBtn.setFillStyle(0x334455));

    this.updateSideStats();
  }

  updateSideStats() {
    const fmt = (side) =>
      this.units
        .filter((u) => u.side === side && u.count > 0)
        .map((u) => `${u.def.name.slice(0, 3)}:${u.count}(♥${hpPerUnit(u)} ⚔${u.def.damage * u.count})`)
        .join("  ") || "—";
    if (this.redStatsTxt) this.redStatsTxt.setText(fmt("red"));
    if (this.blueStatsTxt) this.blueStatsTxt.setText(fmt("blue"));
  }

  updateTurnBar() {
    if (this.currentTurn === "blue") {
      this.turnBarBg.setFillStyle(0x081a2e, 1);
      this.turnTxt.setText("⚔  BLUE's TURN  ⚔").setColor("#7abaff");
    } else {
      this.turnBarBg.setFillStyle(0x2a0808, 1);
      this.turnTxt.setText("⚔  RED's TURN  ⚔").setColor("#ff7a7a");
    }
    this.infoTxt.setText("Select one of your units to act");
  }

  // ── Input ─────────────────────────────────────────────────────────
  registerInput() {
    this.input.on("pointerdown", (ptr) => this.handleClick(ptr));
  }

  handleClick(ptr) {
    if (this.gameOver) return;
    const { x, y } = ptr;
    const clicked = this.findUnitAt(x, y);

    if (clicked) {
      // Own unit → select / reselect
      if (clicked.side === this.currentTurn) {
        this.selectUnit(clicked);
        return;
      }
      // Enemy unit → attack if it's a valid target
      if (this.selectedUnit && this.atkTargets.includes(clicked.id)) {
        this.performAttack(this.selectedUnit, clicked);
        return;
      }
    }

    // Tap on a highlighted move tile
    if (this.selectedUnit) {
      const tile = this.closestTile(x, y);
      if (tile && this.moveTiles.some((t) => t.col === tile.col && t.row === tile.row)) {
        this.performMove(this.selectedUnit, tile.col, tile.row);
        return;
      }
    }

    // Tap elsewhere → deselect
    this.deselectUnit();
  }

  // ── Selection ─────────────────────────────────────────────────────
  selectUnit(unit) {
    this.selectedUnit = unit;

    // Reachable empty tiles
    this.moveTiles = getReachableTiles(unit.col, unit.row, unit.def.speed, this.units);

    // Attackable enemies
    this.atkTargets = [];
    const enemies = this.units.filter((u) => u.side !== unit.side && u.count > 0);

    if (unit.def.ranged) {
      // Ranged: any enemy within range distance
      this.atkTargets = enemies
        .filter((e) => hexDistance(unit.col, unit.row, e.col, e.row) <= unit.def.range)
        .map((e) => e.id);
    } else {
      // Melee: enemies adjacent to current position OR to any reachable tile
      const reachable = [{ col: unit.col, row: unit.row }, ...this.moveTiles];
      for (const e of enemies) {
        if (reachable.some((t) => hexDistance(t.col, t.row, e.col, e.row) === 1)) {
          this.atkTargets.push(e.id);
        }
      }
    }

    this.drawHighlights();
    this.redrawAllUnits();

    const d = unit.def;
    const hpCur = hpPerUnit(unit);
    this.infoTxt.setText(
      `${d.name} (${unit.side.toUpperCase()})  |  Count: ${unit.count}\n` +
        `HP: ${hpCur}/${d.hp}  ⚔ ATK: ${d.damage * unit.count}  SPD: ${d.speed}  ` +
        (d.ranged ? `🏹 Range ${d.range}` : "⚔ Melee"),
    );
  }

  deselectUnit() {
    this.selectedUnit = null;
    this.moveTiles = [];
    this.atkTargets = [];
    this.highlightLayer.clear();
    this.redrawAllUnits();
    if (!this.gameOver) this.infoTxt.setText("Select one of your units to act");
  }

  // ── Actions ───────────────────────────────────────────────────────
  performMove(unit, col, row) {
    unit.col = col;
    unit.row = row;

    // Auto-melee: fight every adjacent enemy after landing
    const adjEnemies = this.units.filter(
      (u) => u.side !== unit.side && u.count > 0 && hexDistance(col, row, u.col, u.row) === 1,
    );
    for (const enemy of adjEnemies) {
      this.meleeExchange(unit, enemy);
      if (unit.count <= 0) break;
    }

    this.deselectUnit();
    this.endTurn();
  }

  performAttack(attacker, defender) {
    if (attacker.def.ranged) {
      this.rangedAttack(attacker, defender);
    } else {
      // Melee: move to the best adjacent tile first (if not already adjacent)
      if (hexDistance(attacker.col, attacker.row, defender.col, defender.row) > 1) {
        // Find adjacent tiles of the defender that are in moveTiles or already occupied by attacker
        const candidates = hexNeighbors(defender.col, defender.row).filter(
          (n) =>
            this.moveTiles.some((t) => t.col === n.col && t.row === n.row) ||
            (n.col === attacker.col && n.row === attacker.row),
        );
        if (candidates.length > 0) {
          // Pick the one closest to the attacker
          candidates.sort(
            (a, b) =>
              hexDistance(a.col, a.row, attacker.col, attacker.row) -
              hexDistance(b.col, b.row, attacker.col, attacker.row),
          );
          const dest = candidates[0];
          if (dest.col !== attacker.col || dest.row !== attacker.row) {
            attacker.col = dest.col;
            attacker.row = dest.row;
          }
        }
      }
      this.meleeExchange(attacker, defender);
    }
    this.deselectUnit();
    this.endTurn();
  }

  meleeExchange(attacker, defender) {
    // Attacker strikes first
    const atkDmg = attacker.count * attacker.def.damage;
    defender.totalHp = Math.max(0, defender.totalHp - atkDmg);
    recalcCount(defender);

    // Defender retaliates if still alive
    if (defender.count > 0) {
      const defDmg = defender.count * defender.def.damage;
      attacker.totalHp = Math.max(0, attacker.totalHp - defDmg);
      recalcCount(attacker);
    }

    this.drawUnit(attacker);
    this.drawUnit(defender);
    this.updateSideStats();
    this.checkVictory();
  }

  rangedAttack(attacker, defender) {
    const dmg = attacker.count * attacker.def.damage;
    defender.totalHp = Math.max(0, defender.totalHp - dmg);
    recalcCount(defender);

    this.drawUnit(defender);
    this.updateSideStats();
    this.checkVictory();
  }

  // ── Turn management ───────────────────────────────────────────────
  endTurn() {
    if (this.gameOver) return;
    this.currentTurn = this.currentTurn === "blue" ? "red" : "blue";
    this.updateTurnBar();
  }

  checkVictory() {
    const blueAlive = this.units.some((u) => u.side === "blue" && u.count > 0);
    const redAlive = this.units.some((u) => u.side === "red" && u.count > 0);
    if (blueAlive && redAlive) return;

    this.gameOver = true;
    const winner = blueAlive ? "BLUE" : "RED";
    const winColor = blueAlive ? "#7abaff" : "#ff7a7a";

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0, 0);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, `${winner} WINS!`, {
        fontFamily: "Arial Black, Arial",
        fontSize: "44px",
        color: winColor,
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5, 0.5);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 24, "Tap to restart", {
        fontFamily: "Arial",
        fontSize: "18px",
        color: "#cccccc",
      })
      .setOrigin(0.5, 0.5);

    this.input.once("pointerdown", () => this.scene.restart());
  }

  // ── Rendering helpers ─────────────────────────────────────────────
  drawHighlights() {
    this.highlightLayer.clear();

    // Movement tiles – green
    this.highlightLayer.lineStyle(2, 0x44ff44, 0.9);
    this.highlightLayer.fillStyle(0x44ff44, 0.22);
    for (const tile of this.moveTiles) {
      const { x, y } = tileCenter(tile.col, tile.row);
      const pts = hexPoints(x, y, HEX_SIZE);
      this.highlightLayer.fillPoints(pts, true);
      this.highlightLayer.strokePoints(pts, true);
    }

    // Attack targets – red glow over enemy hex
    this.highlightLayer.lineStyle(3, 0xff4444, 1.0);
    this.highlightLayer.fillStyle(0xff4444, 0.28);
    for (const id of this.atkTargets) {
      const e = this.units.find((u) => u.id === id);
      if (!e || e.count <= 0) continue;
      const { x, y } = tileCenter(e.col, e.row);
      const pts = hexPoints(x, y, HEX_SIZE);
      this.highlightLayer.fillPoints(pts, true);
      this.highlightLayer.strokePoints(pts, true);
    }
  }

  // Redraw all units (e.g. after selection changes to show/remove gold ring)
  redrawAllUnits() {
    for (const u of this.units) this.drawUnit(u);
  }

  findUnitAt(x, y) {
    const R = HEX_SIZE + 4;
    return this.units.find((u) => {
      if (u.count <= 0) return false;
      const c = tileCenter(u.col, u.row);
      return Phaser.Math.Distance.Between(x, y, c.x, c.y) <= R;
    });
  }

  closestTile(x, y) {
    let best = null;
    let bestD = Infinity;
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const c = tileCenter(col, row);
        const d = Phaser.Math.Distance.Between(x, y, c.x, c.y);
        if (d < bestD) {
          bestD = d;
          best = { col, row };
        }
      }
    }
    return bestD <= HEX_SIZE ? best : null;
  }
}

// ── Phaser config ─────────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game",
  backgroundColor: "#0e1626",
  scene: [BattlefieldScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
