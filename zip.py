import zipfile
import os

with zipfile.ZipFile('dune-airdrop-addon-1.3.2.zip', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('.'):
        if '.git' in root or 'node_modules' in root:
            continue
        for file in files:
            if file == 'dune-airdrop-addon-1.3.2.zip' or file == 'zip.py':
                continue
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, '.')
            zf.write(file_path, arcname)
print("Zip created")
