import { ASSET_LIBRARY_OPTIONS, type AssetLibraryCode, useAssetLibrary } from "@/lib/assetLibrary";

export default function AssetLibrarySwitcher({ className = "" }: { className?: string }) {
  const { library, setLibrary } = useAssetLibrary();
  const current = ASSET_LIBRARY_OPTIONS.find((item) => item.code === library);

  return (
    <div className={`group relative shrink-0 ${className}`.trim()}>
      <button
        type="button"
        aria-label="当前素材库"
        className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        {current?.label ?? "汽车素材库"}
      </button>
      <div className="invisible absolute right-0 top-full z-50 mt-1 min-w-[10.5rem] rounded-md border border-white/20 bg-slate-950/95 p-1 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100">
        {ASSET_LIBRARY_OPTIONS.map((item) => {
          const selected = item.code === library;
          return (
            <button
              key={item.code}
              type="button"
              className={
                selected
                  ? "block w-full whitespace-nowrap rounded !bg-slate-800 px-2.5 py-1.5 text-left text-sm font-medium !text-white"
                  : "block w-full whitespace-nowrap rounded !bg-transparent px-2.5 py-1.5 text-left text-sm text-slate-200 hover:!bg-white/10 hover:text-white"
              }
              onClick={() => setLibrary(item.code as AssetLibraryCode)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
