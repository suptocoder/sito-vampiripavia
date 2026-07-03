<?
	include ("./header_help.php");
	include ("../script/parser.php");
	
	OpenConnection();
	
	$sql = "";
	$sql .= "SELECT argomenti.titolo,argomenti.testo,argomenti.id_capitolo,";
	$sql .= "capitoli.titolo_capitolo ";
	$sql .= "FROM help_argomenti argomenti INNER JOIN help_capitoli capitoli ";
	$sql .= "ON capitoli.id = argomenti.id_capitolo ";
	$sql .= "WHERE argomenti.id = ".$_GET['id'];
	
	$query = mysql_query($sql);
	
	$testo = mysql_result($query,0,'testo');
	$testo = parseMessageInverse($testo);

?>

<script language="javascript">	
	
	function check()
	{		
		return true;
	}		
	
	function getCaretPos(textA){
		if (textA.createTextRange){
			textA.caretPos = document.selection.createRange();				
		}
	}
	
	function formatText(frmt){
		if (document.help.testo.caretPos && document.help.testo.createTextRange){
			document.help.testo.caretPos.text = '[' + frmt + '][/' + frmt + ']';
		}else{
			document.help.testo.value += '[' + frmt + '][/' + frmt + ']';
		}
		
		document.help.testo.focus();
	}			
</script>
		
<script language="javascript" src="../script/parser.js"></script>

		
<div align="center">
	<table border="0" cellpadding="0" cellspacing="3">	
		<tr>
			<td class="medium" align="right">Titolo:</td>
			<td colspan="2">
				<form action="gest_help_mod_submit.php" name="help" method="post" onSubmit="return check()">
				<input type="text" name="titolo" size="70" class="textfield_scuro" value="<?=mysql_result($query,0,'argomenti.titolo')?>">
			</td>
		</tr>
		
		<tr>
			<td class="medium" align="right" valign="top">Testo:</td>
			<td><textarea rows="30" cols="90" onClick="getCaretPos(this)" onKeyup="getCaretPos(this)" name="testo" class="textarea_scura"><?=$testo?></textarea></td>
			<td valign="top">
				<table border="0" cellpadding="0" cellspacing="3">								
					<!--TESTO-->
					<tr>
						<td><a href="javascript: formatText('bold')"><img src="../images/editor_bold.gif" border="0"></a></td>
					</tr>
					<tr>
						<td><a href="javascript: formatText('italic')"><img src="../images/editor_italic.gif" border="0"></a></td>
					</tr>
					<tr>
						<td><a href="javascript: formatText('underline')"><img src="../images/editor_underline.gif" border="0"></a></td>
					</tr>				
					<tr>
						<td><a href="javascript: formatText('url')"><img src="../images/editor_url.gif" border="0"></a></td>						
					</tr>								
					<tr>						
						<td><a href="javascript: formatText('center')"><img src="../images/editor_center.gif" border="0"></a></td>												
					</tr>							
					<tr>
						<td><a href="javascript: formatText('red')"><img src="../images/editor_red.gif" border="0"></a></td>						
					</tr>	
					<tr>
						<td><a href="javascript: formatText('table')"><img src="../images/tabella.gif" border="0"></a></td>						
					</tr>												
					<tr>
						<td align="center"><a href="javascript: formatText('F10')" class="plain_e"><b>10</b></a></td>						
					</tr>	
				</table>
			</td>
		</tr>
		
		<tr>
			<td>&nbsp;</td>
			<td align="center">
				<input type="submit" value="Salva" class="button">
				<input type="hidden" name="id_argomento" value="<?=$_GET['id']?>">				
				</form>
			</td>
			<td>&nbsp;</td>
		</tr>
		
		<tr>
			<td colspan="3" class="small" align="center">
				<a href="gest_help.php" class="plain_e">Indice</a>
			</td>
		</tr>
	</table>
</div>

<?
	CloseConnection();
	
	include ("./footer_help.php");
?>

