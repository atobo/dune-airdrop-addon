// Core Blueprint Parsing, Transforming and SQL Generation logic

const STRUCTURAL_BUILDING_TYPES = new Set([
  "Atreides_Outpost_Column",
  "Atreides_Outpost_Column_Corner",
  "Atreides_Outpost_Foundation",
  "Atreides_Outpost_Foundation_Round_Corner",
  "Atreides_Outpost_Foundation_Wedge",
  "Atreides_Outpost_Pillar_Bottom",
  "Atreides_Outpost_Pillar_Middle",
  "Atreides_Outpost_Pillar_Top",
  "Choam_Level2_Column",
  "Choam_Level2_Foundation",
  "Choam_Level2_Pillar_Bottom",
  "Choam_Shelter_Column_Corner_New",
  "Choam_Shelter_Column_New",
  "Harkonnen_Outpost_Column",
  "Harkonnen_Outpost_Foundation",
  "MTX_Neut_DesertMechanic_Center_Column",
  "MTX_Neut_DesertMechanic_Corner_Column",
  "MTX_Neut_DesertMechanic_Foundation",
  "MTX_Neut_DesertMechanic_Foundation_Wedge",
  "MTX_Gunner_Foundation",
  "MTX_Smug_Foundation",
  "MTX_Smug_Foundation_Full",
  "MTX_Smug_Foundation_Half",
  "MTX_Smug_Foundation_Quarter",
  "MTX_Smug_Foundation_Round_Corner",
  "MTX_Smug_Foundation_Wedge",
  "MTX_Smug_Pillar_Bottom",
  "MTX_Smug_Pillar_Middle",
  "MTX_Smug_Pillar_Top",
  "MTX_Smug_Column",
  "MTX_Smug_Corner_Column",
  "Watershippers_Foundation",
  "Watershippers_Foundation_Round_Corner",
  "Watershippers_Pillar_Bottom",
  "Watershippers_Pillar_Middle",
  "Watershippers_Pillar_Top",
  "Atre_Foundation_Full",
  "Hark_Foundation_Full",
  "Choam_Foundation_Full"
]);

function isStructural(buildingType) {
  return STRUCTURAL_BUILDING_TYPES.has(buildingType);
}

// Parse string JSON to object
function parseBlueprint(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    
    // Normalize format
    const bp = {
      name: data.name || "Unnamed Blueprint",
      instances: Array.isArray(data.instances) ? data.instances : [],
      placeables: Array.isArray(data.placeables) ? data.placeables : [],
      pentashields: Array.isArray(data.pentashields) ? data.pentashields : []
    };
    
    if (bp.instances.length === 0 && bp.placeables.length === 0 && bp.pentashields.length === 0) {
      throw new Error("Blueprint has no structural instances, placeables, or pentashields.");
    }
    
    return bp;
  } catch (err) {
    throw new Error("Failed to parse JSON: " + err.message);
  }
}

// Calculate bounding box and center
function getBlueprintCenter(bp) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let count = 0;

  const processPoint = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    count++;
  };

  bp.instances.forEach(i => processPoint(i.x, i.y));
  bp.placeables.forEach(p => processPoint(p.x, p.y));

  if (count === 0) {
    return { x: 0, y: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    minX, maxX, minY, maxY
  };
}

// Apply offsets and yaw rotation around center
function transformBlueprint(bp, dx, dy, dz, rotDegrees) {
  const center = getBlueprintCenter(bp);
  const rad = (rotDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const rotatePoint = (px, py) => {
    // Translate to center origin
    const tx = px - center.x;
    const ty = py - center.y;
    // Rotate
    const rx = tx * cos - ty * sin;
    const ry = tx * sin + ty * cos;
    // Translate back and add global offset
    return {
      x: rx + center.x + dx,
      y: ry + center.y + dy
    };
  };

  const newInstances = bp.instances.map(inst => {
    const rotated = rotatePoint(inst.x, inst.y);
    return {
      ...inst,
      x: Math.round((rotated.x + Number.EPSILON) * 100) / 100,
      y: Math.round((rotated.y + Number.EPSILON) * 100) / 100,
      z: Math.round((inst.z + dz + Number.EPSILON) * 100) / 100,
      rotation: Math.round((inst.rotation + rotDegrees) % 360)
    };
  });

  const newPlaceables = bp.placeables.map(pl => {
    const rotated = rotatePoint(pl.x, pl.y);
    return {
      ...pl,
      x: Math.round((rotated.x + Number.EPSILON) * 100) / 100,
      y: Math.round((rotated.y + Number.EPSILON) * 100) / 100,
      z: Math.round((pl.z + dz + Number.EPSILON) * 100) / 100,
      rx: pl.rx ?? 0,
      ry: pl.ry ?? 0,
      rz: Math.round(((pl.rz ?? 0) + rotDegrees) % 360) // Yaw component
    };
  });

  // Pentashields usually have placeable_id matching a placeable's coordinate.
  // We keep their scales as is.
  const newPentashields = bp.pentashields.map(ps => ({ ...ps }));

  return {
    name: bp.name,
    instances: newInstances,
    placeables: newPlaceables,
    pentashields: newPentashields
  };
}

// Generate SQL script to construct building directly on the map (World Construction)
function generateDirectConstructionSQL(bp, buildingId, ownerEntityId) {
  let sql = `-- Arrakis Blueprint Auto-Generated Direct World Construction Script
-- Target Building ID: ${buildingId}
-- Owner Entity ID: ${ownerEntityId}
-- Blueprint Name: ${bp.name}
-- Generated at: ${new Date().toISOString()}

BEGIN;

-- Ensure building ID exists in buildings table
INSERT INTO dune.buildings (id) 
VALUES (${buildingId}) 
ON CONFLICT (id) DO NOTHING;

-- Clean existing instances for this building ID to avoid conflicts
DELETE FROM dune.building_instances WHERE building_id = ${buildingId};
\n`;

  if (bp.instances.length > 0) {
    sql += `    -- Inserting ${bp.instances.length} constructed building instances\n`;
    const chunks = chunkArray(bp.instances, 50);
    chunks.forEach((chunk) => {
      sql += `    INSERT INTO dune.building_instances\n`;
      sql += `      (building_id, instance_id, building_type, transform, owner_entity_id, building_flags, health, shelter, stabilization_begin_timespan, stabilization_end_timespan, stabilization_state, sand_buildup)\n`;
      sql += `    VALUES\n`;
      sql += chunk.map((inst) => {
        // Convert Euler Yaw (rotation in degrees) to Quaternion (Yaw only: QX=0, QY=0, QZ=sin(Yaw/2), QW=cos(Yaw/2))
        const rad = (inst.rotation * Math.PI) / 360;
        const qz = Math.sin(rad);
        const qw = Math.cos(rad);
        
        return `      (${buildingId}, ${inst.instance_id}, '${inst.building_type}', ARRAY[${inst.x},${inst.y},${inst.z},0.0,0.0,${qz.toFixed(6)},${qw.toFixed(6)}]::real[], ${ownerEntityId}, 0, 100.0, 0.0, 0, 0, 0, 0.0)`;
      }).join(",\n") + ";\n\n";
    });
  }

  sql += `COMMIT;
`;

  return sql;
}

// Generate the fully compatible PostgreSQL import script
function generateSQLScript(bp, playerPawnId, customName, itemTemplateId = 'BuildingBlueprint_CopyDevice') {
  const name = customName || bp.name || "Imported Blueprint";
  const nameJson = JSON.stringify(name);
  const escapedPawnId = playerPawnId.replace(/'/g, "''");

  let sql = `-- Arrakis Blueprint Auto-Generated SQL Import Script
-- Target Player: ${playerPawnId}
-- Item Template: ${itemTemplateId}
-- Blueprint Name: ${name}
-- Generated at: ${new Date().toISOString()}

BEGIN;

DO $$
DECLARE
    v_inv_id integer;
    v_next_pos integer;
    v_item_id integer;
    v_blueprint_id integer;
BEGIN
    -- Resolve main inventory id (type 0) for target player
    SELECT id INTO v_inv_id FROM dune.inventories
    WHERE actor_id = '${escapedPawnId}' AND inventory_type = 0
    ORDER BY id LIMIT 1;

    IF v_inv_id IS NULL THEN
        RAISE EXCEPTION 'Inventory not found for player pawn: %', '${escapedPawnId}';
    END IF;

    -- Get next position index in inventory
    SELECT COALESCE(MAX(position_index), -1) + 1 INTO v_next_pos
    FROM dune.items WHERE inventory_id = v_inv_id;

    -- Insert the item into player inventory
    INSERT INTO dune.items (inventory_id, stack_size, position_index, template_id, quality_level, stats)
    VALUES (
      v_inv_id, 
      1, 
      v_next_pos, 
      '${itemTemplateId}', 
      0, 
      ('{"FCustomizationStats":[[],{}],"FBuildingBlueprintItemStats":[[],{"PlayerBlueprintId":"!!bbp#0","BuildingBlueprintName":' || ${JSON.stringify(nameJson)} || '}],"FItemStackAndDurabilityStats":[[],{"DecayedMaxDurability":0.0}]}')::jsonb
    )
    RETURNING id INTO v_item_id;

    -- Create building blueprint record
    INSERT INTO dune.building_blueprints (item_id, player_id, building_blueprint_map)
    VALUES (v_item_id, NULL, '')
    RETURNING id INTO v_blueprint_id;

    -- Update item stats with real blueprint database ID
    UPDATE dune.items
    SET stats = jsonb_set(stats, '{FBuildingBlueprintItemStats,1,PlayerBlueprintId}', to_jsonb('!!bbp#' || v_blueprint_id::text))
    WHERE id = v_item_id;
\n`;

  // Instances
  if (bp.instances.length > 0) {
    sql += `    -- Inserting ${bp.instances.length} building instances\n`;
    const chunks = chunkArray(bp.instances, 50);
    chunks.forEach((chunk) => {
      sql += `    INSERT INTO dune.building_blueprint_instances\n`;
      sql += `      (building_blueprint_id, instance_id, building_type, transform, hologram, provides_stability, health)\n`;
      sql += `    VALUES\n`;
      sql += chunk.map((inst, index) => {
        const stability = inst.provides_stability != null ? inst.provides_stability : isStructural(inst.building_type);
        return `      (v_blueprint_id, ${inst.instance_id || index + 1}, '${inst.building_type}', ARRAY[${inst.x},${inst.y},${inst.z},${inst.rotation}]::real[], true, ${stability}, 0)`;
      }).join(",\n") + ";\n\n";
    });
  }

  // Placeables
  if (bp.placeables.length > 0) {
    sql += `    -- Inserting ${bp.placeables.length} placeables\n`;
    const chunks = chunkArray(bp.placeables, 50);
    chunks.forEach((chunk) => {
      sql += `    INSERT INTO dune.building_blueprint_placeables\n`;
      sql += `      (building_blueprint_id, placeable_id, building_type, transform, hologram)\n`;
      sql += `    VALUES\n`;
      sql += chunk.map((pl, index) => {
        return `      (v_blueprint_id, ${pl.placeable_id || index + 1}, '${pl.building_type}', ARRAY[${pl.x},${pl.y},${pl.z},${pl.rx ?? 0},${pl.ry ?? 0},${pl.rz ?? 0}]::real[], true)`;
      }).join(",\n") + ";\n\n";
    });
  }

  // Pentashields
  if (bp.pentashields.length > 0) {
    sql += `    -- Inserting ${bp.pentashields.length} pentashields\n`;
    bp.pentashields.forEach(ps => {
      const s = ps.scale || [1, 1, 1];
      sql += `    INSERT INTO dune.building_blueprint_pentashields (building_blueprint_id, placeable_id, scale)\n`;
      sql += `    VALUES (v_blueprint_id, ${ps.placeable_id ?? 0}, ARRAY[${s[0]},${s[1]},${s[2]}]::smallint[]);\n`;
    });
  }

  sql += `    RAISE NOTICE 'Imported blueprint % successfully as database ID %', ${JSON.stringify(name)}, v_blueprint_id;
END $$;

COMMIT;
`;

  return sql;
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// Make functions available globally for browser
window.BlueprintParser = {
  parseBlueprint,
  getBlueprintCenter,
  transformBlueprint,
  generateSQLScript,
  generateDirectConstructionSQL,
  isStructural
};
