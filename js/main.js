
const puppeteer = require('puppeteer');
const https = require('https');
const http = require('http');
const fs = require('fs');
const cors = require('cors');
const express = require('express');
const { setInterval } = require('timers/promises');
app = express();
// const screenShot = async () => {
//     const browser = await puppeteer.launch();
//     const page = await browser.newPage();
//     await page.goto('https://ro.betano.com');
//     await page.screenshot({ path: 'example.png' });
//     let selector = ".sb-modal__close__btn";
//     await page.click(selector);
//     await page.waitForTimeout(5000);
//     await page.screenshot({ path: 'example2.png' });
//     await browser.close();
// };

// screenShot();



app.use(express.static('public'));
// app.use(express.json());

var links = {
    link: [],
    i: [],
    j: [],

}

// function showToFrontEnd() {
var theUrl = "https://api.efortuna.ro/live3/api/live/matches/overview";
let urlBetano = "https://ro.betano.com/api/sport/fotbal/meciurile-urmatoare-de-azi/";
let urlBetano1 = "https://ro.betano.com/api/sport/fotbal/urmatoarele-24-ore/?sort=Leagues";
let anurl = "http://crm.motumaregalimob.ro/adminsystem/property_list.asp";
let poateURl = "/cote/salford-city-peterborough/betbuilder/29452376/"
app.get('/efortuna', (req, res) => {


    https.get(theUrl, (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
            data += chunk;
        });
        resp.on('end', () => {
            // data = JSON.parse(data);
            res.json(data);
        });
    });


});
app.get('/betano1', (req, res) => {

    https.get(urlBetano, (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
            data += chunk;
        });
        resp.on('end', () => {
            // data = JSON.parse(data);
            res.json(data);
        });
    });


});
app.get('/betano', (req, res) => {

    https.get(urlBetano1, (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
            data += chunk;
        });
        resp.on('end', () => {



            let d = data;
            // vreauJSON1 = d;
            // vreauJSON1 = JSON.parse(vreauJSON1);
            // let nr = 0;
            // for (let i = 0; i < vreauJSON1.data.blocks.length; i++) {
            //     for (let j = 0; j < vreauJSON1.data.blocks[i].events.length; j++) {
            //         //mai jos recuperez lincul pentru nicun pariu pe egal
            //         let UrlPariuEgal = "https://ro.betano.com/api";
            //         let UrlNiciunPariuPeEgal = vreauJSON1.data.blocks[i].events[j].url;
            //         // console.log(UrlNiciunPariuPeEgal);
            //         // if (UrlNiciunPariuPeEgal != null) {
            //         UrlNiciunPariuPeEgal = UrlPariuEgal + UrlNiciunPariuPeEgal;
            //         links.link[nr++] = UrlNiciunPariuPeEgal;
            //         links.i[nr] = i;
            //         links.j[nr] = j;
            //         // }

            //     }
            // }
            // // console.log(vreauJSON1.data.blocks[1].events[1].markets[0].selections[0].price);
            // console.log(vreauJSON1.data.blocks[1].events[0].url);
            // console.log(links);

            res.json(data);
        });
        var superObjs = {
            data1: [],
        };
        for (let i = 0; i <= links.link.length; i++) {
            var link = "/links" + i;
            console.log('am intrat aici' + link);
            app.get(link, (req, res) => {

                // console.log(links);
                https.get(links.link[i], (resp) => {
                    var data = "";

                    resp.on('data', (chunk) => {
                        data += chunk;

                    });

                    // The whole response has been received. Print out the result.
                    resp.on('end', () => {
                        console.log(i);

                        superObjs.data1[i] = data;
                        if (i == links.link.length - 1) {
                            console.log("got to the last one " + i);
                            console.log(superObjs);
                            res.json(superObjs);

                        }
                        else {
                            res.json(data);
                        }

                    });
                    console.log('am ajuns aici ' + i);
                });

            });
            if (i == 0) {
                app.get("/link", (req, res) => {
                    // console.log(links);
                    res.json(links);
                });
            }
        }
    });


});
console.log("afisez linksobjs");
console.log(links);


// }

app.listen(process.env.PORT || 3000, () => console.log(process.env.PORT));

// showToFrontEnd();




