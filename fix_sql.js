const fs = require('fs');
let content = fs.readFileSync('setup_playtime_airdrops.sql', 'utf8');

// 1. Fix missing BEGIN in fn_queue_reward_roll
content = content.replace(
  /v_schem_template TEXT;\n\s*-- Roll Gear/g,
  "v_schem_template TEXT;\n  v_gear_quality INT;\n  v_res_qty_1 INT;\n  v_res_qty_2 INT;\nBEGIN\n  -- Roll Gear"
);

// 2. Remove duplicate trg_track_playtime
const lines = content.split('\n');
let newLines = [];
let skip = false;
let foundTrg = 0;

for(let i=0; i<lines.length; i++) {
  if (lines[i].includes('-- 9. Trigger handler running on player updates')) {
    foundTrg++;
    if (foundTrg === 2) {
      skip = true; // Skip the second copy
    }
  }
  
  if (skip && lines[i].includes('$$ LANGUAGE plpgsql;')) {
    skip = false;
    continue; // Skip this line too
  }

  if (!skip) {
    newLines.push(lines[i]);
  }
}

content = newLines.join('\n');

fs.writeFileSync('setup_playtime_airdrops.sql', content);
console.log('Fixed and wrote to setup_playtime_airdrops.sql');
