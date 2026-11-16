import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(100);
Config.setCodec("h264");
Config.setCrf(14);
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);
