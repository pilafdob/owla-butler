// The host supplies Electron; declare only the two APIs OWLA uses.
declare module 'electron' {
 export const shell:{openExternal(url:string):Promise<void>};
 export const webUtils:{getPathForFile(file:File):string};
}
