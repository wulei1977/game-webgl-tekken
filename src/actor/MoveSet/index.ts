// 角色招式表注册：帧数据 JSON 位于 config/movesets/，修改 JSON 即可调参，无需改源码
import common from '../../../config/movesets/common.json';
import heishi from '../../../config/movesets/heishi.json';
import golem from '../../../config/movesets/golem.json';
import rina from '../../../config/movesets/rina.json';
import { buildCharacter } from '../../core/FrameData';
import type { CharacterDef } from '../../core/types';

type Json = Record<string, unknown>;

export const CHARACTER_IDS = ['heishi', 'golem', 'rina'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

const SOURCES: Record<CharacterId, Json> = {
  heishi: heishi as unknown as Json,
  golem: golem as unknown as Json,
  rina: rina as unknown as Json,
};

export const CHARACTERS: Record<string, CharacterDef> = {};
for (const id of CHARACTER_IDS) {
  CHARACTERS[id] = buildCharacter(SOURCES[id], common as unknown as Json);
}

export function getCharacter(id: string): CharacterDef {
  const c = CHARACTERS[id];
  if (!c) throw new Error(`未知角色 "${id}"`);
  return c;
}
