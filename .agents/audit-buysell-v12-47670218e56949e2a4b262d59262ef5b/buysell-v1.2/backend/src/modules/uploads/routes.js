import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError, asyncHandler } from '../../utils/http.js';
import { putObject } from '../../utils/s3.js';

export const uploadsRouter=Router();
const isS3=env.storageDriver==='s3';
if(!isS3) fs.mkdirSync(path.resolve(env.storageLocalDir),{recursive:true});
const diskStorage=multer.diskStorage({destination:(_req,_file,cb)=>cb(null,path.resolve(env.storageLocalDir)),filename:(_req,file,cb)=>cb(null,`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)});
const upload=multer({storage:isS3?multer.memoryStorage():diskStorage,limits:{fileSize:20*1024*1024},fileFilter:(_req,file,cb)=>{const ok=/^(image|video)\//.test(file.mimetype)||file.mimetype==='application/pdf';cb(ok?null:new HttpError(415,'Unsupported upload type'),ok);}});

uploadsRouter.post('/',requireAuth,upload.single('file'),asyncHandler(async(req,res)=>{
  if(!req.file)throw new HttpError(400,'file is required');
  if(isS3){
    const ext=path.extname(req.file.originalname).toLowerCase();
    const key=`uploads/${req.user.id}/${new Date().toISOString().slice(0,10)}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    const url=await putObject({key,body:req.file.buffer,contentType:req.file.mimetype});
    return res.status(201).json({url,key,filename:req.file.originalname,mimetype:req.file.mimetype,size:req.file.size,storage:'s3'});
  }
  res.status(201).json({url:`${env.publicUploadBaseUrl.replace(/\/$/,'')}/${req.file.filename}`,filename:req.file.filename,mimetype:req.file.mimetype,size:req.file.size,storage:'local',warning:env.nodeEnv==='production'?'Local Render filesystem is ephemeral; set STORAGE_DRIVER=s3 for production.':undefined});
}));
