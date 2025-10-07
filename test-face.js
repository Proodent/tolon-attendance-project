import fs from "fs";
import fetch from "node-fetch";

const image = fs.readFileSync("face.jpg"); // Replace with your image path
const base64 = `data:image/jpeg;base64,${image.toString("base64")}`;

const response = await fetch("http://145.223.33.154:8081/api/v1/recognition/recognize?limit=5", {
  method: "POST",
  headers: {
    "x-api-key": "4f4766d9-fc3b-436a-b24e-f57851a1c865",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ file: base64 }),
});

const data = await response.json();
console.log(data);
