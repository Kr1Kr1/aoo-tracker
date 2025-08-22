import { readdir } from 'fs/promises';
import path from 'path';
import Image from 'next/image';

async function getAssets() {
  const assetTypes = ['tiles', 'elements', 'avatars', 'walls'];
  const assets: { [key: string]: string[] } = {};

  for (const type of assetTypes) {
    try {
      const dirPath = path.join(process.cwd(), 'public', 'assets', type);
      const files = await readdir(dirPath);
      assets[type] = files.filter(file => 
        /\.(jpg|jpeg|png|gif|svg)$/i.test(file)
      );
    } catch (error) {
      console.error(`Error reading ${type} directory:`, error);
      assets[type] = [];
    }
  }

  return assets;
}

export default async function AssetsPage() {
  const assets = await getAssets();

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">Game Assets</h1>
      
      {Object.entries(assets).map(([type, files]) => (
        <div key={type} className="space-y-4">
          <h2 className="text-xl font-semibold capitalize">{type}</h2>
          
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {files.map((file) => (
              <div key={file} className="group relative aspect-square overflow-hidden rounded-lg border bg-background">
                <Image
                  src={`/assets/${type}/${file}`}
                  alt={file}
                  fill
                  className="object-contain p-2"
                  sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 16vw"
                />
                <div className="absolute inset-x-0 bottom-0 bg-background/80 p-2 text-xs opacity-0 transition-opacity group-hover:opacity-100">
                  {file}
                </div>
              </div>
            ))}
          </div>
          
          {files.length === 0 && (
            <p className="text-sm text-muted-foreground">No {type} found</p>
          )}
        </div>
      ))}
    </div>
  );
}
