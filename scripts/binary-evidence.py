"""只读提取配套 APK so 的已核验函数；不依赖 IDB 或临时符号缓存。"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
import capstone

parser = argparse.ArgumentParser()
parser.add_argument('binary', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
data = args.binary.read_bytes()
if data[:5] != b'\x7fELF\x02':
    raise ValueError('需要 ELF64 二进制')
phoff = struct.unpack_from('<Q', data, 32)[0]
entsize, count = struct.unpack_from('<HH', data, 54)
segments = []
for index in range(count):
    pos = phoff + index * entsize
    kind = struct.unpack_from('<I', data, pos)[0]
    offset, address = struct.unpack_from('<QQ', data, pos + 8)
    size = struct.unpack_from('<Q', data, pos + 32)[0]
    if kind == 1:
        segments.append((address, offset, size))

def read(address, size):
    for start, offset, length in segments:
        if start <= address and address + size <= start + length:
            return data[offset + address - start:offset + address - start + size]
    raise ValueError(f'地址未映射：{address:#x}')

engine = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_LITTLE_ENDIAN)
functions = {}
for name, address, size in [('GetWorldZImpl', 0x49A7BF0, 0x48), ('GetNoteSize', 0x49A7C38, 0x28), ('SolveTime', 0x49A80E8, 0x108)]:
    functions[name] = {
        'rva': hex(address),
        'bytes': read(address, size).hex(),
        'instructions': [f'{i.address:X} {i.mnemonic} {i.op_str}' for i in engine.disasm(read(address, size), address)],
    }
constants = {hex(address): struct.unpack('<f', read(address, 4))[0] for address in [0x1AA1500, 0x1AA1238, 0x1AA0F68, 0x1AA13F4, 0x1AA1504]}
result = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'functions': functions, 'constants': constants}
args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'sha256': result['sha256'], 'constants': constants}, ensure_ascii=False))
