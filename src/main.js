const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;
const HEX_SIZE = 34;
const COLS = 13;
const ROWS = 9;
const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
const HEX_HEIGHT_STEP = HEX_SIZE * 1.5;
const BOARD_ORIGIN_X = 110;
const BOARD_ORIGIN_Y = 95;
const UNIT_RADIUS = 14;

const UNITS = [
  { id: "A1", side: "blue", col: 1, row: 2 },
  { id: "A2", side: "blue", col: 1, row: 6 },
  { id: "B1", side: "red", col: 10, row: 2 },
  { id: "B2", side: "red", col: 10, row: 6 },
];

function tileCenter(col, row) {
  return {
    x: BOARD_ORIGIN_X + col * HEX_WIDTH + (row % 2) * (HEX_WIDTH / 2),
    y: BOARD_ORIGIN_Y + row * HEX_HEIGHT_STEP,
  };
}

function hexPoints(cx, cy, size) {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = Phaser.Math.DegToRad(60 * i - 30);
    points.push(new Phaser.Math.Vector2(cx + size * Math.cos(angle), cy + size * Math.sin(angle)));
  }
  return points;
}

class BattlefieldScene extends Phaser.Scene {
  constructor() {
    super("BattlefieldScene");
    this.hexLayer = null;
    this.highlightLayer = null;
    this.unitLayer = null;
    this.grid = [];
    this.units = [];
    this.selectedUnit = null;
    this.selectionLabel = null;
  }

  create() {
    this.cameras.main.setBackgroundColor("#1e2e1f");
    this.add.text(20, 18, "HoMM3 Battlefield Skeleton", {
      fontFamily: "Arial",
      fontSize: "24px",
      color: "#f0f0f0",
    });
    this.selectionLabel = this.add.text(20, 52, "Selected: none", {
      fontFamily: "Arial",
      fontSize: "18px",
      color: "#f0f0f0",
    });

    this.hexLayer = this.add.graphics();
    this.highlightLayer = this.add.graphics();
    this.unitLayer = this.add.layer();

    this.buildGrid();
    this.spawnUnits();
    this.registerInput();
  }

  buildGrid() {
    this.grid = [];
    this.hexLayer.clear();
    this.hexLayer.lineStyle(1, 0x9db584, 0.55);
    this.hexLayer.fillStyle(0x35513b, 0.2);

    for (let row = 0; row < ROWS; row += 1) {
      const rowTiles = [];
      for (let col = 0; col < COLS; col += 1) {
        const center = tileCenter(col, row);
        const points = hexPoints(center.x, center.y, HEX_SIZE);
        this.hexLayer.fillPoints(points, true);
        this.hexLayer.strokePoints(points, true);
        rowTiles.push({ col, row, ...center });
      }
      this.grid.push(rowTiles);
    }
  }

  spawnUnits() {
    this.units = UNITS.map((unit) => this.createUnit(unit));
  }

  createUnit(unitData) {
    const center = tileCenter(unitData.col, unitData.row);
    const color = unitData.side === "blue" ? 0x4a9eff : 0xeb4b4b;

    const marker = this.add.circle(center.x, center.y, UNIT_RADIUS, color, 1);
    marker.setStrokeStyle(2, 0x0f1113, 0.95);

    const label = this.add.text(center.x, center.y, unitData.id, {
      fontFamily: "Arial",
      fontSize: "11px",
      color: "#ffffff",
    });
    label.setOrigin(0.5);

    this.unitLayer.add([marker, label]);

    return {
      ...unitData,
      marker,
      label,
    };
  }

  registerInput() {
    this.input.on("pointermove", (pointer) => {
      const tile = this.closestTile(pointer.x, pointer.y);
      this.drawHighlight(tile);
    });

    this.input.on("pointerdown", (pointer) => {
      const clickedUnit = this.findUnitAt(pointer.x, pointer.y);
      if (clickedUnit) {
        this.selectedUnit = clickedUnit;
        this.selectionLabel.setText(`Selected: ${clickedUnit.id}`);
        this.refreshUnitStyles();
        return;
      }

      if (!this.selectedUnit) {
        return;
      }

      const targetTile = this.closestTile(pointer.x, pointer.y);
      if (!targetTile || this.isTileOccupied(targetTile.col, targetTile.row)) {
        return;
      }

      this.moveUnit(this.selectedUnit, targetTile.col, targetTile.row);
    });
  }

  findUnitAt(x, y) {
    return this.units.find(
      (unit) => Phaser.Math.Distance.Between(x, y, unit.marker.x, unit.marker.y) <= UNIT_RADIUS + 6,
    );
  }

  isTileOccupied(col, row) {
    return this.units.some((unit) => unit.col === col && unit.row === row);
  }

  moveUnit(unit, col, row) {
    const center = tileCenter(col, row);
    unit.col = col;
    unit.row = row;
    unit.marker.setPosition(center.x, center.y);
    unit.label.setPosition(center.x, center.y);
  }

  refreshUnitStyles() {
    for (const unit of this.units) {
      const isSelected = unit.id === this.selectedUnit?.id;
      const lineWidth = isSelected ? 4 : 2;
      const lineColor = isSelected ? 0xf5d742 : 0x0f1113;
      unit.marker.setStrokeStyle(lineWidth, lineColor, 0.95);
    }
  }

  closestTile(x, y) {
    let bestTile = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const rowTiles of this.grid) {
      for (const tile of rowTiles) {
        const distance = Phaser.Math.Distance.Between(x, y, tile.x, tile.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestTile = tile;
        }
      }
    }

    return bestDistance <= HEX_SIZE ? bestTile : null;
  }

  drawHighlight(tile) {
    this.highlightLayer.clear();
    if (!tile) {
      return;
    }

    const points = hexPoints(tile.x, tile.y, HEX_SIZE);
    this.highlightLayer.lineStyle(2, 0xf5d742, 0.95);
    this.highlightLayer.fillStyle(0xf5d742, 0.2);
    this.highlightLayer.fillPoints(points, true);
    this.highlightLayer.strokePoints(points, true);
  }
}

const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game",
  backgroundColor: "#1e2e1f",
  scene: [BattlefieldScene],
};

new Phaser.Game(config);
