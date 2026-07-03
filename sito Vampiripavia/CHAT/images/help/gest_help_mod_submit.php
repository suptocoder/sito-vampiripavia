<?
	include ("../db_connect.php");
	include ("../script/parser.php");
	
	OpenConnection();
	
	$testo = parseMessage($_POST['testo']);
	
	$sql = "";
	$sql .= "UPDATE help_argomenti SET titolo = '".$_POST['titolo']."',";
	$sql .= "testo = '".$testo."' ";
	$sql .= "WHERE id = ".$_POST['id_argomento'];
	
	$query = mysql_query($sql);
	
	CloseConnection();
	
	header("Location: gest_help.php");
?>