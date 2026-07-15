import zipfile, os
with zipfile.ZipFile('/home/atobo/dune-docker-addons/dune-airdrop-addon-1.3.1.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('.'):
        if '.git' in root or 'node_modules' in root or '__pycache__' in root:
            continue
        for file in files:
            zpath = os.path.relpath(os.path.join(root, file), '.')
            zf.write(os.path.join(root, file), zpath)
print("Zip created successfully.")
