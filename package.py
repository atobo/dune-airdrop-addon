import zipfile, os

def should_include(path):
    parts = path.split(os.sep)
    if any(p.startswith('.') for p in parts if p != '.'): return False
    if 'node_modules' in parts or 'tests' in parts or 'scripts' in parts or 'scratch' in parts: return False
    
    if parts[0] == 'package.json' or parts[0] == 'package-lock.json':
        return False
        
    if path.endswith('.py') or path.endswith('.log') or path.endswith('.zip'):
        return False
        
    if len(parts) == 1 and path.endswith('.js'):
        return False

    return True

with zipfile.ZipFile('dune-airdrop-addon-1.3.3.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('.'):
        for file in files:
            zpath = os.path.relpath(os.path.join(root, file), '.')
            if should_include(zpath):
                zf.write(os.path.join(root, file), zpath)
print("Zip created successfully.")
