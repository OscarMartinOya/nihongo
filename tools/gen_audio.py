"""Genera los audios del curso con la voz neuronal ja-JP-NanamiNeural (paquete edge-tts).

Uso:  pip install edge-tts
      python tools/gen_audio.py          # solo crea los que faltan
      python tools/gen_audio.py --all    # los regenera todos
Lee audio/manifest.json (lo crea tools/audio-manifest.js) y borra los mp3 que ya no se usan.
"""
import asyncio
import json
import pathlib
import sys

import edge_tts

VOICE = "ja-JP-NanamiNeural"
RATE = "-10%"  # un poco más lento que lo normal, para aprender
# Textos que la voz no lee bien sueltos: se le pasa otra grafía con el mismo sonido.
SAY_AS = {"ゔ": "ヴ"}
AUDIO = pathlib.Path(__file__).resolve().parent.parent / "audio"


async def one(key, text, sem):
    out = AUDIO / f"{key}.mp3"
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(SAY_AS.get(text, text), VOICE, rate=RATE).save(str(out))
                if out.stat().st_size > 1000:
                    return
            except Exception as e:  # noqa: BLE001
                print(f"  reintento {key} ({text}): {e}")
            await asyncio.sleep(1 + attempt)
        print(f"FALLO {key} ({text})")


async def main():
    manifest = json.loads((AUDIO / "manifest.json").read_text(encoding="utf-8"))
    redo = "--all" in sys.argv
    todo = {k: t for k, t in manifest.items() if redo or not (AUDIO / f"{k}.mp3").exists() or (AUDIO / f"{k}.mp3").stat().st_size < 1000}
    for f in AUDIO.glob("*.mp3"):
        if f.stem not in manifest:
            f.unlink()
            print("borrado", f.name)
    print(f"{len(todo)} audios por generar de {len(manifest)}")
    sem = asyncio.Semaphore(4)
    await asyncio.gather(*(one(k, t, sem) for k, t in todo.items()))
    total = sum(f.stat().st_size for f in AUDIO.glob("*.mp3"))
    print(f"listo: {len(list(AUDIO.glob('*.mp3')))} archivos, {total / 1024 / 1024:.2f} MB")


asyncio.run(main())
