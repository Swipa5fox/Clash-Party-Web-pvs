import { MD5 } from 'crypto-js'

// ponytail: 原 HashType 类(equal/isValid/makeHash 全项目零调用)删掉,只留真正被用的 getHash
export const getHash = (name: string): string => MD5(name).toString()
