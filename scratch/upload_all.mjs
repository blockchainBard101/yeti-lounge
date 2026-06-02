import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const IMGS_DIR = '/home/blockchainbard/Documents/Hackathon/lofi/yeti lounge/frontend/public/lofi-img';
const OUTPUT_FILE = '/home/blockchainbard/Documents/Hackathon/lofi/yeti lounge/frontend/components/walrus-assets.json';

async function main() {
  console.log('Reading Yeti image assets directory...');
  const files = fs.readdirSync(IMGS_DIR);
  
  const mapping = {};
  
  // Pre-load mascot since we already uploaded it successfully
  mapping['yeti-mascot.png'] = 'j9xkr0qHdPJusiM1oGUhxEJkSkJOkkDHTWXPPKFJszo';
  
  for (const file of files) {
    if (file === 'yeti-mascot.png') continue; // Skip since we have it
    if (file.startsWith('.')) continue; // Skip hidden files
    
    const filePath = path.join(IMGS_DIR, file);
    console.log(`\n==============================================`);
    console.log(`Uploading asset to Walrus Testnet: ${file}`);
    console.log(`==============================================`);
    
    try {
      // Execute the walrus store command and capture stdout
      const cmd = `walrus store --context testnet --epochs 5 --json "${filePath}"`;
      const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      
      const parsed = JSON.parse(stdout.trim());
      const resultObj = parsed[0]?.blobStoreResult?.newlyCreated || parsed[0]?.blobStoreResult?.alreadyCertified;
      
      let blobId = '';
      if (resultObj) {
        blobId = resultObj.blobObject?.blobId || resultObj.blobId;
      }
      
      if (blobId) {
        mapping[file] = blobId;
        console.log(`\n✅ Upload Success! File: ${file} -> BlobID: ${blobId}`);
      } else {
        console.error(`⚠️ Upload succeeded but couldn't parse blob ID from JSON output.`);
      }
    } catch (err) {
      console.error(`❌ Failed to upload ${file}:`, err.message);
    }
  }
  
  // Save the mapping file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapping, null, 2));
  console.log(`\n🎉 Success! Decoupled asset registry written to:\n${OUTPUT_FILE}`);
}

main().catch(console.error);
